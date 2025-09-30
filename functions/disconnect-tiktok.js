const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId } = JSON.parse(event.body);
    
    // First check if connection exists
    const { data: existing, error: checkError } = await supabase
      .from('streaming_connections')
      .select('id')
      .eq('user_id', userId)
      .eq('platform', 'tiktok');
    
    // If there's a connection, delete it
    if (existing && existing.length > 0) {
      const { error: deleteError } = await supabase
        .from('streaming_connections')
        .delete()
        .eq('user_id', userId)
        .eq('platform', 'tiktok');
        
      if (deleteError) {
        console.error('Delete error:', deleteError);
        throw deleteError;
      }
    }
    
    // Return success whether we deleted something or not
    return {
      statusCode: 200,
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ success: true })
    };
    
  } catch (error) {
    console.error('Disconnect TikTok error:', error);
    return {
      statusCode: 500,
      headers: { 
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};