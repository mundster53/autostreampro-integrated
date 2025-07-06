const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      }
    };
  }

  try {
    console.log('Starting queue processing...');

    const { data: pendingUploads, error } = await supabase
      .from('publishing_queue')
      .select('*')
      .eq('platform', 'youtube')
      .eq('status', 'failed')
      .limit(5);

    if (error) throw error;

    console.log(`Found ${pendingUploads.length} failed uploads to retry`);

    for (const upload of pendingUploads) {
      try {
        await supabase
          .from('publishing_queue')
          .update({ 
            status: 'pending',
            attempts: upload.attempts + 1 
          })
          .eq('id', upload.id);

        const uploadResult = await fetch(`https://beautiful-rugelach-bda4b4.netlify.app/.netlify/functions/upload-to-youtube`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            clipId: upload.clip_id
          })
        });

        if (uploadResult.ok) {
          const response = await uploadResult.json();
          
          if (response.success) {
            await supabase
              .from('publishing_queue')
              .update({ 
                status: 'completed',
                completed_at: new Date().toISOString()
              })
              .eq('id', upload.id);

            // CORRECT - Fixed column names and added required fields:
await supabase
            .from('published_content')
            .insert({
              clip_id: upload.clip_id,
              platform: 'youtube',
              platform_post_id: response.youtubeId,  // ✅ Correct column name
              platform_url: response.youtubeUrl || `https://www.youtube.com/watch?v=${response.youtubeId}`,
              published_at: new Date().toISOString(),
              last_metrics_update: new Date().toISOString(),
              metrics: {}  // Empty JSON object for now
  });

            console.log(`Successfully processed: ${upload.clip_id}`);
          } else {
            throw new Error(response.error || 'Upload failed');
          }
        } else {
          const errorText = await uploadResult.text();
          throw new Error(`HTTP ${uploadResult.status}: ${errorText}`);
        }

      } catch (uploadError) {
        console.error(`Upload error for ${upload.clip_id}:`, uploadError.message);
        
        await supabase
          .from('publishing_queue')
          .update({ 
            status: 'failed',
            last_error: uploadError.message
          })
          .eq('id', upload.id);
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        processed: pendingUploads.length,
        message: 'Queue processed successfully'
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
        error: error.message
      })
    };
  }
};
