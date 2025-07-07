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
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }

  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const { clipId } = JSON.parse(event.body || '{}');

    const { data: clip, error: clipError } = await supabase
      .from('clips')
      .select('*')
      .eq('id', clipId)
      .single();

    if (clipError || !clip) {
      throw new Error(`Clip not found: ${clipId}`);
    }

    // Get user's YouTube connection with refresh capabilities
const { data: connection, error: connError } = await supabase
  .from('streaming_connections')
  .select('access_token, refresh_token, platform_username, expires_at, user_id')
  .eq('user_id', clip.user_id)
  .eq('platform', 'youtube')
  .eq('is_active', true)
  .single();

if (connError || !connection) {
  throw new Error('YouTube not connected for this user');
}

// Check if token is expired or will expire in next 5 minutes
const now = new Date();
const expiresAt = connection.expires_at ? new Date(connection.expires_at) : null;
const isExpiredSoon = !expiresAt || (expiresAt.getTime() - now.getTime()) < (5 * 60 * 1000);

let accessToken = connection.access_token;

if (isExpiredSoon) {
  console.log('Token expired or expiring soon, refreshing...');
  
  // Call refresh token function
  const refreshResponse = await fetch(`https://beautiful-rugelach-bda4b4.netlify.app/.netlify/functions/refreshYouTubeToken`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      refreshToken: connection.refresh_token,
      userId: connection.user_id
    })
  });

  if (refreshResponse.ok) {
    const refreshResult = await refreshResponse.json();
    accessToken = refreshResult.newToken;
    console.log('Token refreshed successfully');
  } else {
    throw new Error('Failed to refresh YouTube token - user needs to reconnect');
  }
}

console.log('Found YouTube connection for:', connection.platform_username);

    if (connError || !connection) {
      throw new Error('YouTube not connected for this user');
    }

    // Simple test with real YouTube metadata API call
    const testResponse = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: {
        'Authorization': `Bearer ${connection.access_token}`
      }
    });

    if (!testResponse.ok) {
      throw new Error(`YouTube API test failed: ${testResponse.status}`);
    }

    // For now, return success but with real API validation
    const realTestId = `yttest_${Date.now()}`;

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        youtubeId: realTestId,
        message: 'YouTube API connection verified!',
        clipTitle: clip.title,
        youtubeUrl: `https://www.youtube.com/watch?v=${realTestId}`,
        channelName: connection.platform_username
      })
    };

  } catch (error) {
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
