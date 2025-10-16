// functions/youtube-auth.js

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

// encode a small "return_to" in OAuth state
function encodeState(returnTo) {
  try {
    return Buffer.from(JSON.stringify({ r: returnTo || '/dashboard.html' }))
      .toString('base64url');
  } catch {
    return Buffer.from(JSON.stringify({ r: '/dashboard.html' })).toString('base64url');
  }
}
function decodeState(state) {
  try {
    const obj = JSON.parse(Buffer.from(state || '', 'base64url').toString('utf8'));
    return (obj && typeof obj.r === 'string') ? obj.r : '/dashboard.html';
  } catch {
    return '/dashboard.html';
  }
}

function buildYouTubeAuthUrl(baseUrl, clientId, returnTo) {
  const redirectUri = `${baseUrl}/auth/youtube/callback`;
  const scope = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube'
  ].join(' ');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope,
    state: encodeState(returnTo)
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

async function exchangeCodeForTokens({ code, clientId, clientSecret, redirectUri }) {
  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const res = await globalThis.fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    })
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    const msg = data?.error_description || data?.error || 'Token exchange failed';
    const err = new Error(msg);
    err.details = data;
    throw err;
  }
  return data; // { access_token, refresh_token, expires_in, scope, token_type, ... }
}

async function fetchYouTubeChannel(accessToken) {
  const res = await globalThis.fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {

    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.error?.message || 'Failed to fetch channel');
    err.details = data;
    throw err;
  }
  const ch = (data.items && data.items[0]) || {};
  return {
    id: ch.id || null,
    title: ch.snippet?.title || null,
    thumbnail: ch.snippet?.thumbnails?.default?.url || null
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
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      },
      body: ''
    };
  }

  try {
    const qs = event.queryStringParameters || {};
    const method = event.httpMethod || 'GET';
    const accept = (event.headers?.accept || '').toLowerCase();

    const clientId = process.env.YOUTUBE_CLIENT_ID;
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  return json(500, { error: 'Missing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET in Netlify env' });
}

    const baseUrl = process.env.PUBLIC_BASE_URL || baseUrlFromHeaders(event.headers || {});
    const redirectUri = `${baseUrl}/auth/youtube/callback`;

    console.log('[yt-auth] baseUrl =', baseUrl);
    console.log('[yt-auth] redirectUri =', redirectUri);
    console.log('[yt-auth] clientId  =', process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID);
    console.log('[yt-auth] path/method/qs =', event.path, event.httpMethod, event.queryStringParameters);



    // --- START FLOW: GET with no ?code → redirect to Google (only need clientId here)
    if (method === 'GET' && !qs.code && !qs.error) {
      if (!clientId) {
        return json(500, { error: 'Missing YOUTUBE_CLIENT_ID/GOOGLE_CLIENT_ID' });
      }
      const returnTo = qs.return_to || '/dashboard.html';
      const authUrl = buildYouTubeAuthUrl(baseUrl, clientId, returnTo);
      return {
        statusCode: 302,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
          Location: authUrl
        },
        body: ''
      };
    }

    // Callback error
    if (method === 'GET' && qs.error) {
      return json(400, { error: 'YouTube authorization error', details: qs });
    }

    // --- CALLBACK / EXCHANGE: support both GET ?code=... and POST { code }
    let code = qs.code;
    if (!code && method === 'POST' && event.body) {
      try {
        const body = JSON.parse(event.body);
        code = body.code;
      } catch {
        /* ignore */
      }
    }
    if (!code) {
      const authUrl = buildYouTubeAuthUrl(baseUrl, clientId, qs.return_to);
      return json(400, { error: 'No authorization code provided', auth_url: authUrl });
    }

    // For token exchange we DO require both id + secret
    if (!clientId || !clientSecret) {
      return json(500, { error: 'Missing YouTube client credentials in env.' });
    }

    // Exchange code → tokens
    const token = await exchangeCodeForTokens({ code, clientId, clientSecret, redirectUri });

    // Optional: get channel info (handy for UI)
    let channel = null;
    try {
      channel = await fetchYouTubeChannel(token.access_token);
    } catch (e) {
      console.warn('[YouTube] channel fetch warning:', e.message);
    }

    // Optional: persist in Supabase (adapt to your schema)
    /*
    const { data: authUser } = await supabase.auth.getUser(); // if you pass a session JWT
    const currentUserId = authUser?.user?.id; // or supply via state
    if (currentUserId) {
      await supabase.from('publishing_connections').upsert({
        user_id: currentUserId,
        platform: 'youtube',
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: new Date(Date.now() + (token.expires_in || 0) * 1000).toISOString(),
        profile_id: channel?.id || null,
        profile_name: channel?.title || null,
        avatar_url: channel?.thumbnail || null
      }, { onConflict: 'user_id,platform' });
    }
    */

    // ---------- Browser-friendly callback redirect ----------
    // Prefer the return target from OAuth state; fall back to query or dashboard.
    const returnTo = qs.state ? decodeState(qs.state) : (qs.return_to || '/dashboard.html');

    // If this was a browser GET (user clicked a link), redirect back to the app.
    // If it's an XHR/POST (your UI doing AJAX), return JSON instead.
    if (method === 'GET' && !accept.includes('application/json')) {
      return {
        statusCode: 302,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
          Location: returnTo
        },
        body: ''
      };
    }

    // JSON response for programmatic callers (AJAX)
    return json(200, {
      success: true,
      platform: 'youtube',
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_in: token.expires_in,
      scope: token.scope,
      token_type: token.token_type,
      channel
    });
  } catch (err) {
    console.error('YouTube auth error:', err.message, err.details || '');
    return json(500, { error: 'Authentication failed', details: err.message, more: err.details });
  }
};
