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

    // Verify channel exists
    const channelResponse = await fetch(`https://kick.com/api/v2/channels/${kickUsername}`);
    if (!channelResponse.ok) {
      throw new Error('Kick channel not found');
    }

    const channelData = await channelResponse.json();

    // Store connection
    const { data: existing } = await supabase
      .from('streaming_connections')
      .select('id')
      .eq('user_id', userId)
      .eq('platform', 'kick')
      .single();

    const connectionData = {
      user_id: userId,
      platform: 'kick',
      platform_user_id: channelData.id.toString(),
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
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
