const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event, context) => {
  try {
    // Get pending YouTube uploads
    const { data: pendingUploads, error } = await supabase
      .from('publishing_queue')
      .select('*')
      .eq('platform', 'youtube')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .limit(5); // Process 5 at a time

    if (error) throw error;

    for (const upload of pendingUploads) {
      try {
        // Update attempts
        await supabase
          .from('publishing_queue')
          .update({ attempts: upload.attempts + 1 })
          .eq('id', upload.id);

        // Call YouTube upload function
        const uploadResult = await fetch(`${process.env.NETLIFY_URL}/.netlify/functions/upload-to-youtube`, {
          method: 'POST',
          body: JSON.stringify({
            clipId: upload.clip_id,
            userId: 'e067a518-c578-4b11-bdfd-470ff92d3d69', // Duncan's user ID
            accessToken: 'youtube_access_token_here' // You'll need to get this from OAuth
          })
        });

        if (uploadResult.ok) {
          // Mark as completed
          await supabase
            .from('publishing_queue')
            .update({ 
              status: 'completed',
              completed_at: new Date().toISOString()
            })
            .eq('id', upload.id);

          // Add to published_content
          const response = await uploadResult.json();
          await supabase
            .from('published_content')
            .insert({
              clip_id: upload.clip_id,
              platform: 'youtube',
              external_id: response.youtubeId,
              published_at: new Date().toISOString()
            });
        } else {
          throw new Error('Upload failed');
        }

      } catch (uploadError) {
        // Mark as failed
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
      body: JSON.stringify({
        processed: pendingUploads.length,
        message: 'Queue processed successfully'
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message
      })
    };
  }
};
