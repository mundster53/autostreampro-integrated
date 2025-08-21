const { createClient } = require('@supabase/supabase-js');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

exports.handler = async (event, context) => {
  try {
    console.log('[AutoUpload] Starting upload process...');
    
    // Find clips ready for upload with viral content
    const { data: readyClips, error } = await supabase
      .from('clips')
      .select('*')
      .eq('status', 'ready_for_upload')
      .eq('upload_status', 'pending')
      .not('viral_title', 'is', null)
      .limit(5); // Process 5 at a time
    
    if (error) throw error;
    
    console.log(`[AutoUpload] Found ${readyClips?.length || 0} clips ready for upload`);
    
    const results = {
      youtube: [],
      failed: [],
      deleted: []
    };
    
    for (const clip of readyClips || []) {
      try {
        console.log(`[AutoUpload] Processing clip ${clip.id}`);
        
        // Update status to uploading
        await supabase
          .from('clips')
          .update({ upload_status: 'uploading' })
          .eq('id', clip.id);
        
        // Upload to YouTube
        const uploadResponse = await fetch(`${process.env.NETLIFY_URL}/.netlify/functions/upload-to-youtube`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clipId: clip.id })
        });
        
        if (uploadResponse.ok) {
          const uploadResult = await uploadResponse.json();
          
          // Update database with YouTube URL
          await supabase
            .from('clips')
            .update({ 
              youtube_url: uploadResult.youtubeUrl,
              upload_status: 'uploaded',
              status: 'published',
              published_at: new Date().toISOString()
            })
            .eq('id', clip.id);
          
          results.youtube.push({
            clipId: clip.id,
            title: clip.viral_title,
            youtubeUrl: uploadResult.youtubeUrl
          });
          
          // DELETE FROM S3 after successful upload
          if (clip.video_url && clip.video_url.includes('s3')) {
            try {
              const url = new URL(clip.video_url);
              const key = url.pathname.substring(1);
              
              await s3.send(new DeleteObjectCommand({
                Bucket: process.env.S3_BUCKET_NAME || 'autostreampro-temp-clips',
                Key: key
              }));
              
              await supabase
                .from('clips')
                .update({ 
                  deleted_from_s3: true,
                  video_url: null // Clear S3 URL
                })
                .eq('id', clip.id);
              
              results.deleted.push(key);
              console.log(`[AutoUpload] Deleted from S3: ${key}`);
              
            } catch (deleteError) {
              console.error(`[AutoUpload] S3 deletion failed:`, deleteError);
            }
          }
          
        } else {
          // Upload failed
          await supabase
            .from('clips')
            .update({ 
              upload_status: 'failed',
              status: 'upload_failed'
            })
            .eq('id', clip.id);
          
          results.failed.push(clip.id);
        }
        
      } catch (clipError) {
        console.error(`[AutoUpload] Error processing clip ${clip.id}:`, clipError);
        results.failed.push(clip.id);
      }
    }
    
    // Clean up old rejected clips from S3
    const { data: rejectedClips } = await supabase
      .from('clips')
      .select('id, video_url')
      .eq('status', 'rejected_low_score')
      .eq('deleted_from_s3', false)
      .not('video_url', 'is', null)
      .limit(10);
    
    for (const clip of rejectedClips || []) {
      if (clip.video_url && clip.video_url.includes('s3')) {
        try {
          const url = new URL(clip.video_url);
          const key = url.pathname.substring(1);
          
          await s3.send(new DeleteObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME || 'autostreampro-temp-clips',
            Key: key
          }));
          
          await supabase
            .from('clips')
            .update({ deleted_from_s3: true })
            .eq('id', clip.id);
          
          results.deleted.push(key);
          
        } catch (error) {
          console.error(`[AutoUpload] Failed to delete rejected clip:`, error);
        }
      }
    }
    
    console.log('[AutoUpload] Process complete:', results);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        uploaded: results.youtube.length,
        failed: results.failed.length,
        deletedFromS3: results.deleted.length,
        results: results
      })
    };
    
  } catch (error) {
    console.error('[AutoUpload] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};