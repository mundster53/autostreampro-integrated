// functions/api/youtube-exchange.js
export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://www.autostreampro.com',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
};

export const onRequestPost = async ({ request, env }) => {
  const cors = {
    'Access-Control-Allow-Origin': 'https://www.autostreampro.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  try {
    // 1) Require Supabase JWT from browser
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // 2) Read body
    const { code } = await request.json();
    if (!code) {
      return new Response(JSON.stringify({ error: 'Missing code' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // 3) Exchange with Google
    const body = new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.OAUTH_REDIRECT_YT,
      grant_type: 'authorization_code'
    });

    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    const data = await resp.json();
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: 'Token exchange failed', details: data }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // 4) Identify the user from Supabase JWT (validate via service role)
    // Minimal Supabase verify call; adjust table/columns to your schema.
    const userResp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!userResp.ok) {
      return new Response(JSON.stringify({ error: 'Invalid Supabase session' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const user = await userResp.json();
    const userId = user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: 'No user id' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // 5) Persist tokens (service key on server only)
    const upsert = await fetch(`${env.SUPABASE_URL}/rest/v1/oauth_tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify([{
        user_id: userId,
        provider: 'youtube',
        access_token: data.access_token,
        refresh_token: data.refresh_token || null,
        scope: data.scope || null,
        token_type: data.token_type || 'Bearer',
        expires_in: data.expires_in || null,
        obtained_at: new Date().toISOString()
      }])
    });

    if (!upsert.ok) {
      const err = await upsert.text();
      return new Response(JSON.stringify({ error: 'Failed to store tokens', details: err }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // 6) Done
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (e) {
    return new Response(JSON.stringify({ error: 'Server error', details: String(e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
};