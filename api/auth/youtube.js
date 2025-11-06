// Vercel serverless function for YouTube OAuth
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET: Redirect to Google OAuth
  if (req.method === 'GET') {
    const { userId, return_to } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const redirectUri = 'https://www.autostreampro.com/auth/youtube.html';
    const state = JSON.stringify({ userId, return_to });
    
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);

    return res.redirect(307, authUrl.toString());
  }

  // POST: Exchange code for tokens and save to database
  if (req.method === 'POST') {
    try {
      const { code, userId } = req.body;
      
      if (!code) {
        return res.status(400).json({ error: 'Authorization code required' });
      }
      
      if (!userId) {
        return res.status(400).json({ error: 'userId required' });
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
        console.error('YouTube token exchange failed:', tokenData);
        return res.status(400).json({ 
          error: tokenData.error_description || 'Token exchange failed' 
        });
      }

      // Get channel info
      let channelInfo = {
        channel_id: 'youtube_channel',
        channel_title: 'YouTube Channel'
      };
      
      if (tokenData.access_token) {
        try {
          const channelResponse = await fetch(
            'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
            {
              headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
            }
          );
          
          if (channelResponse.ok) {
            const channelData = await channelResponse.json();
            if (channelData.items && channelData.items.length > 0) {
              const channel = channelData.items[0];
              channelInfo = {
                channel_id: channel.id,
                channel_title: channel.snippet.title
              };
            }
          }
        } catch (error) {
          console.error('Failed to get YouTube channel info:', error);
        }
      }

      // Save to database
      const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString();
      
      const { error: dbError } = await supabase
        .from('streaming_connections')
        .upsert({
          user_id: userId,
          platform: 'youtube',
          platform_user_id: channelInfo.channel_id,
          platform_username: channelInfo.channel_title,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_expires_at: expiresAt,
          is_active: true,
          connected_at: new Date().toISOString(),
          last_refreshed: new Date().toISOString()
        }, {
          onConflict: 'user_id,platform'
        });

      if (dbError) {
        console.error('Database error:', dbError);
        return res.status(500).json({ 
          error: 'Failed to save connection',
          details: dbError.message 
        });
      }

      return res.status(200).json({
        success: true,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in,
        ...channelInfo
      });

    } catch (error) {
      console.error('YouTube auth error:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
