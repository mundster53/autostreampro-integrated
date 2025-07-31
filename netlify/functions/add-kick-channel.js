const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
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
    const { userId, kickUsername } = JSON.parse(event.body);

    if (!userId || !kickUsername) {
      throw new Error('Missing userId or kickUsername');
    }

    console.log(`Adding Kick channel ${kickUsername} for user ${userId}`);

    // Skip Kick API verification due to Cloudflare blocking
    // We'll trust the user knows their own username
    console.log('Skipping Kick API verification due to Cloudflare protection');

    // Check if connection already exists
    const { data: existing } = await supabase
      .from('streaming_connections')
      .select('id')
      .eq('user_id', userId)
      .eq('platform', 'kick')
      .single();

    const connectionData = {
      user_id: userId,
      platform: 'kick',
      platform_user_id: `kick_${kickUsername}`, // Use username as ID since we can't get real ID
      platform_username: kickUsername,
      access_token: 'PUBLIC_ACCESS',
      refresh_token: 'NOT_APPLICABLE',
      is_active: true,
      connected_at: new Date().toISOString()
    };

    if (existing) {
      await supabase
        .from('streaming_connections')
        .update(connectionData)
        .eq('id', existing.id);
    } else {
      await supabase
        .from('streaming_connections')
        .insert(connectionData);
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        username: kickUsername
      })
    };

  } catch (error) {
    console.error('Kick connection error:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
