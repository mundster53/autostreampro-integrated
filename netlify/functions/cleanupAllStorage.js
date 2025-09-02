// netlify/functions/cleanupAllStorage.js
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
  console.log('[Cleanup] Starting storage cleanup...');
  
  try {
    // Find rejected clips that haven't been deleted
    const { data: rejectedClips, error } = await supabase
      .from('clips')
      .select('id, video_url')
      .eq('status', 'rejected_low_score')
      .eq('deleted_from_storage', false)
      .not('video_url', 'is', null)
      .limit(100);
    
    if (error) {
      throw error;
    }
    
    let deletedCount = 0;
    let errors = [];
    
    for (const clip of rejectedClips || []) {
      try {
        if (clip.video_url.includes('s3')) {
          // Delete from S3
          await deleteFromS3(clip);
        } else {
          // Delete from Supabase
          await deleteFromSupabase(clip);
        }
        deletedCount++;
      } catch (deleteError) {
        console.error(`Failed to delete clip ${clip.id}:`, deleteError);
        errors.push({ clipId: clip.id, error: deleteError.message });
      }
    }

    // ADD THIS AFTER THE REJECTED CLIPS SECTION
// Clean up files from successfully uploaded clips
const { data: uploadedClips, error: uploadError } = await supabase
  .from('clips')
  .select('id, video_url')
  .not('youtube_id', 'is', null)  // Has been uploaded
  .eq('deleted_from_storage', false)  // But file not deleted
  .not('video_url', 'is', null)  // Still has a URL
  .like('video_url', '%supabase%')  // Supabase storage only
  .limit(50);

if (!uploadError && uploadedClips) {
  for (const clip of uploadedClips) {
    try {
      // Extract filename from URL
      const filename = clip.video_url.split('/').pop();
      
      const { error } = await supabase.storage
        .from('clips')
        .remove([filename]);
      
      if (!error) {
        // Mark as deleted
        await supabase
          .from('clips')
          .update({ 
            deleted_from_storage: true,
            video_url: null
          })
          .eq('id', clip.id);
          
        deletedCount++;
        console.log(`[Cleanup] Deleted uploaded clip file: ${filename}`);
      }
    } catch (e) {
      errors.push({ clipId: clip.id, error: e.message });
    }
  }
}
    
    // Also clean up very old rejected clips from database (older than 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const { data: oldClips, error: oldError } = await supabase
      .from('clips')
      .delete()
      .eq('status', 'rejected_low_score')
      .lt('created_at', sevenDaysAgo.toISOString())
      .select('id');
    
    const dbDeleted = oldClips ? oldClips.length : 0;
    
    console.log(`[Cleanup] Complete - Storage: ${deletedCount}, Database: ${dbDeleted}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        storageDeleted: deletedCount,
        databaseDeleted: dbDeleted,
        errors: errors.length > 0 ? errors : undefined
      })
    };
    
  } catch (error) {
    console.error('[Cleanup] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};

async function deleteFromS3(clip) {
  const url = new URL(clip.video_url);
  const key = url.pathname.substring(1);
  
  await s3.send(new DeleteObjectCommand({
    Bucket: process.env.MY_S3_BUCKET_NAME,  // YOUR ACTUAL BUCKET
    Key: key
  }));
  
  // Mark as deleted in database
  await supabase
    .from('clips')
    .update({ 
      deleted_from_storage: true,
      video_url: null
    })
    .eq('id', clip.id);
    
  console.log(`[Cleanup] Deleted from S3: ${key}`);
}

async function deleteFromSupabase(clip) {
  try {
    await supabase.storage
      .from('clips')
      .remove([clip.video_url]);
  } catch (e) {
    // Try alternative path format
    const path = clip.video_url.split('/').pop();
    await supabase.storage
      .from('clips')
      .remove([path]);
  }
  
  // Mark as deleted in database
  await supabase
    .from('clips')
    .update({ 
      deleted_from_storage: true,
      video_url: null
    })
    .eq('id', clip.id);
    
  console.log(`[Cleanup] Deleted from Supabase storage: ${clip.video_url}`);
}