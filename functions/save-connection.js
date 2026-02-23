const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { platform, platformUserId, accessToken, refreshToken, username, userId } = body;

    console.log('[save-connection] Incoming payload:', body);

    if (!platform || !userId) {
      console.error('Missing required fields');
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    const { data, error } = await supabase
      .from('streaming_connections')
      .upsert({
        user_id: userId,
        platform,
        platform_user_id: platformUserId || platform,
        access_token: accessToken || '',
        refresh_token: refreshToken || '',
        platform_username: username || platform,
        is_active: true,
        monitor: true,                           
        status: 'offline',                        
        next_check_at: new Date().toISOString(),  
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,platform' })
      .select();

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }

    console.log('[save-connection] Success:', data);
    return { statusCode: 200, body: JSON.stringify({ success: true, data }) };

  } catch (err) {
    console.error('save-connection handler error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
