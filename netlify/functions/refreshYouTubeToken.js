const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event, context) => {
  try {
    const { refreshToken, userId } = JSON.parse(event.body || '{}');

    // Use refresh token to get new access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: process.env.YOUTUBE_CLIENT_ID,
        client_secret: process.env.YOUTUBE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      throw new Error(`Token refresh failed: ${tokenData.error}`);
    }

    // Update database with new access token
    const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000));

    await supabase
      .from('streaming_connections')
      .update({
        access_token: tokenData.access_token,
        expires_at: expiresAt.toISOString()
      })
      .eq('user_id', userId)
      .eq('platform', 'youtube');

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        newToken: tokenData.access_token,
        expiresAt: expiresAt.toISOString()
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
