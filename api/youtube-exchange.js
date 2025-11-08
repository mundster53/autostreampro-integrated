// api/youtube-exchange.js - Vercel serverless function
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code, userId } = req.body;
    
    if (!code || !userId) {
      return res.status(400).json({ error: 'Missing code or userId' });
    }

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: 'https://www.autostreampro.com/auth/youtube.html'
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('Token exchange failed:', tokenData);
      return res.status(400).json({ error: tokenData.error_description || 'Token exchange failed' });
    }

    // Get channel info
    let channelInfo = { channel_id: null, platform_username: 'YouTube Channel' };
    
    if (tokenData.access_token) {
      try {
        const channelResponse = await fetch(
          'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
          { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } }
        );
        
        if (channelResponse.ok) {
          const channelData = await channelResponse.json();
          if (channelData.items && channelData.items.length > 0) {
            const channel = channelData.items[0];
            channelInfo = {
              channel_id: channel.id,
              platform_username: channel.snippet.title
            };
          }
        }
      } catch (error) {
        console.error('Failed to get channel info:', error);
      }
    }

    // Save to database
    const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString();
    const now = new Date().toISOString();
    
    const { error: dbError } = await supabase
      .from('streaming_connections')
      .upsert({
        user_id: userId,
        platform: 'youtube',
        platform_user_id: channelInfo.channel_id,
        platform_username: channelInfo.platform_username,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresAt,
        is_active: true,
        created_at: now,
        updated_at: now
      }, {
        onConflict: 'user_id,platform'
      });

    if (dbError) {
      console.error('Database error:', dbError);
      return res.status(500).json({ error: 'Failed to save connection' });
    }

    return res.status(200).json({
      success: true,
      channel_id: channelInfo.channel_id,
      channel_title: channelInfo.platform_username
    });

  } catch (error) {
    console.error('Exchange error:', error);
    return res.status(500).json({ error: error.message });
  }
};