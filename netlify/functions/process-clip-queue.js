// netlify/functions/process-clip-queue.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event, context) => {
  // CORS headers
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
      }
    };
  }

  try {
    console.log('Starting clip queue processing...');
    
    // Step 1: Find orphaned files in storage and create database entries
    const { data: storageFiles, error: storageError } = await supabase
      .storage
      .from('clips')
      .list();
      
    if (storageError) {
      console.error('Storage list error:', storageError);
    }
    
    let orphanedCount = 0;
    
    if (storageFiles && storageFiles.length > 0) {
      console.log(`Found ${storageFiles.length} files in storage`);
      
      for (const file of storageFiles) {
        // Check if this storage file has a corresponding database entry
        const { data: existingClip } = await supabase
          .from('clips')
          .select('id')
          .or(`storage_path.eq.${file.name},video_url.like.%${file.name}%`)
          .single();
          
        if (!existingClip) {
          console.log(`Creating database entry for orphaned file: ${file.name}`);
          
          // Get the public URL for this file
          const { data: urlData } = supabase
            .storage
            .from('clips')
            .getPublicUrl(file.name);
          
          // Extract info from filename if possible (format: userId_timestamp.mp4)
          const parts = file.name.split('_');
          const userId = parts[0] || null;
          
          // Create database entry
          const { error: insertError } = await supabase
            .from('clips')
            .insert({
              user_id: userId,
              storage_path: file.name,
              video_url: urlData.publicUrl,
              title: `Recovered Clip - ${new Date(file.created_at).toLocaleDateString()}`,
              game: 'Gaming',
              ai_score: 0.5,
              duration: 30,
              status: 'pending',
              source_platform: 'unknown',
              created_at: file.created_at
            });
            
          if (insertError) {
            console.error(`Failed to create entry for ${file.name}:`, insertError);
          } else {
            orphanedCount++;
          }
        }
      }
    }
    
    // Step 2: Get clips ready for YouTube upload
    const { data: pendingClips, error: clipsError } = await supabase
      .from('clips')
      .select('*')
      .is('youtube_id', null)
      .in('status', ['pending', 'ready', 'queued'])
      .gte('ai_score', 0.40) // Only clips above threshold
      .order('ai_score', { ascending: false })
      .limit(5); // Process 5 at a time to avoid timeouts
    
    if (clipsError) {
      console.error('Error fetching pending clips:', clipsError);
      throw clipsError;
    }
    
    console.log(`Found ${pendingClips?.length || 0} clips to process`);
    
    const results = [];
    
    // Step 3: Process each clip through YouTube upload
    if (pendingClips && pendingClips.length > 0) {
      for (const clip of pendingClips) {
        try {
          console.log(`Processing clip: ${clip.id} - ${clip.title}`);
          
          // Mark as processing to avoid double processing
          await supabase
            .from('clips')
            .update({ status: 'processing' })
            .eq('id', clip.id);
          
          // Call your existing upload-to-youtube function
          const uploadResponse = await fetch(`${process.env.URL || 'https://beautiful-rugelach-bda4b4.netlify.app'}/.netlify/functions/upload-to-youtube`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clipId: clip.id })
          });
          
          const uploadResult = await uploadResponse.json();
          
          if (uploadResult.success) {
            console.log(`Successfully uploaded clip ${clip.id} to YouTube: ${uploadResult.youtubeId}`);
            
            // Update clip status
            await supabase
              .from('clips')
              .update({
                status: 'published',
                youtube_id: uploadResult.youtubeId,
                youtube_url: uploadResult.youtubeUrl,
                published_at: new Date().toISOString()
              })
              .eq('id', clip.id);
            
            // Delete from storage if it exists
            if (clip.storage_path) {
              const { error: deleteError } = await supabase
                .storage
                .from('clips')
                .remove([clip.storage_path]);
                
              if (deleteError) {
                console.error(`Failed to delete storage file ${clip.storage_path}:`, deleteError);
              } else {
                console.log(`Deleted ${clip.storage_path} from storage`);
              }
            }
            
            results.push({
              clipId: clip.id,
              success: true,
              youtubeId: uploadResult.youtubeId
            });
          } else {
            console.error(`Failed to upload clip ${clip.id}:`, uploadResult.error);
            
            // Mark as failed
            await supabase
              .from('clips')
              .update({
                status: 'failed',
                error_message: uploadResult.error
              })
              .eq('id', clip.id);
            
            results.push({
              clipId: clip.id,
              success: false,
              error: uploadResult.error
            });
          }
          
        } catch (clipError) {
          console.error(`Error processing clip ${clip.id}:`, clipError);
          
          // Mark as failed
          await supabase
            .from('clips')
            .update({
              status: 'failed',
              error_message: clipError.message
            })
            .eq('id', clip.id);
          
          results.push({
            clipId: clip.id,
            success: false,
            error: clipError.message
          });
        }
      }
    }
    
    // Step 4: Clean up old failed clips (optional)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const { data: oldFailedClips } = await supabase
      .from('clips')
      .select('id, storage_path')
      .eq('status', 'failed')
      .lt('created_at', sevenDaysAgo.toISOString());
    
    if (oldFailedClips && oldFailedClips.length > 0) {
      for (const clip of oldFailedClips) {
        if (clip.storage_path) {
          await supabase.storage.from('clips').remove([clip.storage_path]);
        }
        await supabase.from('clips').delete().eq('id', clip.id);
      }
      console.log(`Cleaned up ${oldFailedClips.length} old failed clips`);
    }
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        message: 'Queue processing complete',
        orphanedFilesFound: orphanedCount,
        clipsProcessed: results.length,
        results: results
      })
    };
    
  } catch (error) {
    console.error('Queue processing error:', error);
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