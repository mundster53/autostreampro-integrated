const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const s3Client = new S3Client({
  region: process.env.MY_AWS_REGION,
  credentials: {
    accessKeyId: process.env.MY_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.MY_AWS_SECRET_ACCESS_KEY
  }
});

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }

  try {
    const { action, clipId, fileName, videoData, videoUrl } = JSON.parse(event.body || '{}');

    if (action === 'upload') {
      // Generate unique filename
      const timestamp = Date.now();
      const s3Key = `clips/${clipId || 'temp'}/${fileName || `clip_${timestamp}.mp4`}`;
      
      let videoBuffer;
      
      // Handle different input types
      if (videoData) {
        // Base64 encoded video
        videoBuffer = Buffer.from(videoData, 'base64');
      } else if (videoUrl) {
        // Download from URL (Twitch, Kick, etc.)
        const response = await fetch(videoUrl);
        const arrayBuffer = await response.arrayBuffer();
        videoBuffer = Buffer.from(arrayBuffer);
      } else {
        throw new Error('No video data or URL provided');
      }
      
      // Upload to S3
      const uploadCommand = new PutObjectCommand({
        Bucket: process.env.MY_S3_BUCKET_NAME,
        Key: s3Key,
        Body: videoBuffer,
        ContentType: 'video/mp4',
        Metadata: {
          clipId: clipId || 'unknown',
          uploadedAt: new Date().toISOString()
        }
      });

      await s3Client.send(uploadCommand);
      
      // Generate public URL
      const s3Url = `https://${process.env.MY_S3_BUCKET_NAME}.s3.${process.env.MY_AWS_REGION}.amazonaws.com/${s3Key}`;
      
      // Update clip record with S3 URL if clipId provided
      if (clipId) {
        await supabase
          .from('clips')
          .update({ 
            video_url: s3Url,
            metadata: { 
              s3_key: s3Key,
              s3_bucket: process.env.MY_S3_BUCKET_NAME,
              storage_type: 's3'
            }
          })
          .eq('id', clipId);
      }
      
      console.log(`Uploaded to S3: ${s3Key}`);
      
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          success: true,
          url: s3Url,
          key: s3Key
        })
      };
      
    } else if (action === 'delete') {
      // Delete from S3
      const { data: clip } = await supabase
        .from('clips')
        .select('metadata, video_url')
        .eq('id', clipId)
        .single();
        
      let s3Key = clip?.metadata?.s3_key;
      
      // Extract key from URL if not in metadata
      if (!s3Key && clip?.video_url?.includes('amazonaws.com')) {
        const urlParts = clip.video_url.split('.amazonaws.com/');
        if (urlParts[1]) {
          s3Key = urlParts[1];
        }
      }
      
      if (s3Key) {
        const deleteCommand = new DeleteObjectCommand({
          Bucket: process.env.MY_S3_BUCKET_NAME,
          Key: s3Key
        });
        
        await s3Client.send(deleteCommand);
        console.log(`Deleted ${s3Key} from S3`);
        
        // Clear the video_url in database
        await supabase
          .from('clips')
          .update({ 
            video_url: null,
            metadata: { 
              ...clip.metadata,
              deleted_from_s3: true,
              deleted_at: new Date().toISOString()
            }
          })
          .eq('id', clipId);
      }
      
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          success: true,
          deleted: s3Key || 'no file to delete'
        })
      };
      
    } else if (action === 'getSignedUrl') {
      // Get temporary signed URL for private buckets
      const { data: clip } = await supabase
        .from('clips')
        .select('metadata')
        .eq('id', clipId)
        .single();
        
      if (clip?.metadata?.s3_key) {
        const command = new GetObjectCommand({
          Bucket: process.env.MY_S3_BUCKET_NAME,
          Key: clip.metadata.s3_key
        });
        
        const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        
        return {
          statusCode: 200,
          body: JSON.stringify({ 
            success: true, 
            url: signedUrl 
          })
        };
      }
      
      throw new Error('No S3 key found for clip');
    }
    
    throw new Error('Invalid action');
    
  } catch (error) {
    console.error('S3 operation failed:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};