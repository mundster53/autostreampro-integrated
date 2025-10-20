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

    if (!platform || !userId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // Upsert (insert or update if already connected)
    const { data, error } = await supabase
      .from('streaming_connections')
      .upsert({
        user_id: userId,
        platform,
        platform_user_id: platformUserId,
        access_token: accessToken,
        refresh_token: refreshToken,
        username,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,platform' })
      .select();

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ success: true, data }) };
  } catch (err) {
    console.error('save-connection error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
