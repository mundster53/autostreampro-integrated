// functions/tiktok-auth.js
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ---------- helpers ----------
function baseUrlFromHeaders(headers = {}) {
  const host = headers['x-forwarded-host'] || headers['host'];
  const proto = headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

function buildTikTokAuthUrl(baseUrl, clientKey, state = null) {
  const redirectUri = `${baseUrl}/auth/tiktok/callback`;
  const scope = ['user.info.basic', 'video.upload', 'video.publish'].join(',');
  const params = new URLSearchParams({
    client_key: clientKey,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    state: state || Math.random().toString(36).slice(2, 10),
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

async function exchangeCodeForTokens({ code, clientKey, clientSecret, redirectUri }) {
  const tokenUrl = 'https://open.tiktokapis.com/v2/oauth/token/';
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri, // important for some apps; safe to send
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    const msg = data?.message || data?.error || 'Token exchange failed';
    const details = data;
    const err = new Error(msg);
    err.details = details;
    throw err;
  }
  return data; // contains access_token, refresh_token, expires_in, refresh_expires_in, etc.
}

async function fetchTikTokUser(accessToken) {
  const url = 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url';
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.message || 'Failed to fetch TikTok user';
    const err = new Error(msg);
    err.details = data;
    throw err;
  }
  const u = data?.data?.user || {};
  return {
    open_id: u.open_id || null,
    display_name: u.display_name || null,
    avatar_url: u.avatar_url || null,
  };
}

// ---------- handler ----------
exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
      body: '',
    };
  }

  try {
    const qs = event.queryStringParameters || {};
    const method = event.httpMethod || 'GET';

    const clientKey = process.env.TIKTOK_CLIENT_KEY || process.env.TIKTOK_CLIENT_ID;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    if (!clientKey || !clientSecret) {
      return json(500, { error: 'Missing TikTok client credentials in env.' });
    }

    const baseUrl =
      process.env.PUBLIC_BASE_URL || baseUrlFromHeaders(event.headers || {});
    const redirectUri = `${baseUrl}/auth/tiktok/callback`;

    // --- START FLOW: GET with no ?code → redirect to TikTok
    if (method === 'GET' && !qs.code && !qs.error) {
      const authUrl = buildTikTokAuthUrl(baseUrl, clientKey, qs.state);
      return {
        statusCode: 302,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
          Location: authUrl,
        },
        body: '',
      };
    }

    // If TikTok returned an error on callback
    if (method === 'GET' && qs.error) {
      return json(400, { error: 'TikTok authorization error', details: qs });
    }

    // --- CALLBACK / EXCHANGE: support both GET ?code=... and POST { code }
    let code = qs.code;
    if (!code && method === 'POST' && event.body) {
      try {
        const body = JSON.parse(event.body);
        code = body.code;
      } catch {
        // ignore parse errors
      }
    }
    if (!code) {
      // Expose an auth_url to let SPAs kick off manually if needed
      const authUrl = buildTikTokAuthUrl(baseUrl, clientKey);
      return json(400, { error: 'No authorization code provided', auth_url: authUrl });
    }

    // Exchange code → tokens
    const token = await exchangeCodeForTokens({
      code,
      clientKey,
      clientSecret,
      redirectUri,
    });

    // Fetch user profile (open_id etc.)
    const user = await fetchTikTokUser(token.access_token);

    // If you want to persist in Supabase, uncomment and adapt to your schema:
    /*
    const { data: authUser } = await supabase.auth.getUser(); // if you pass session JWT
    const currentUserId = authUser?.user?.id; // or pass userId via state/param
    if (currentUserId) {
      await supabase.from('publishing_connections').upsert({
        user_id: currentUserId,
        platform: 'tiktok',
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: new Date(Date.now() + (token.expires_in || 0) * 1000).toISOString(),
        profile_id: user.open_id,
        profile_name: user.display_name,
        avatar_url: user.avatar_url
      }, { onConflict: 'user_id,platform' });
    }
    */

    // Return a clean payload; UI can store as needed
    return json(200, {
      success: true,
      platform: 'tiktok',
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_in: token.expires_in,
      refresh_expires_in: token.refresh_token_expires_in || token.refresh_expires_in,
      user: {
        id: user.open_id,
        username: user.display_name,
        avatar_url: user.avatar_url,
      },
    });
  } catch (err) {
    console.error('TikTok auth error:', err.message, err.details || '');
    return json(500, { error: 'Authentication failed', details: err.message, more: err.details });
  }
};
