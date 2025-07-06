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
                completed_at: new Date()
