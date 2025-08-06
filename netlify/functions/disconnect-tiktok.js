const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  // Add CORS preflight handling
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

  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId } = JSON.parse(event.body);
    
    // Check if connection exists first
    const { data: existing } = await supabase
      .from('streaming_connections')
      .select('id')
      .eq('user_id', userId)
      .eq('platform', 'tiktok')
      .single();
    
    if (existing) {
      // Delete TikTok connection if it exists
      const { error } = await supabase
        .from('streaming_connections')
        .delete()
        .eq('user_id', userId)
        .eq('platform', 'tiktok');
        
      if (error) throw error;
    }
    
    // Always return success - whether we deleted something or not
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        success: true,
        message: 'TikTok disconnected successfully'
      })
    };
    
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message })
    };
  }
};