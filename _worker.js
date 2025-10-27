// _worker.js — permanent API router for Cloudflare Pages
const ORIGINS = ['https://www.autostreampro.com', 'https://www.autostreampro.com'];
const allow = (o) => (ORIGINS.includes(o) ? o : ORIGINS[0]);
const cors = (o) => ({
  'Access-Control-Allow-Origin': allow(o),
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
  'X-ASP-Version': 'worker:stable-v1'
});
const json = (o, code, body) =>
  new Response(JSON.stringify(body), { status: code, headers: { ...cors(o), 'Content-Type': 'application/json' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const path = url.pathname;

    // Health (this is the one your curl is hitting)
    if (path === '/api/ping' && request.method === 'GET') {
      return json(origin, 200, { ok: true, who: 'cf-pages-worker', path, ts: new Date().toISOString() });
    }

    // CORS preflight (already working for you)
    if (path === '/api/youtube-exchange' && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    // YouTube token exchange
    if (path === '/api/youtube-exchange' && request.method === 'POST') {
      try {
        // 1) Supabase JWT from client
        const auth = request.headers.get('Authorization') || '';
        const userJwt = auth.startsWith('Bearer ') ? auth.slice(7) : null;
        if (!userJwt) return json(origin, 401, { error: 'Unauthorized' });

        // 2) Body with Google code
        let body = {}; try { body = await request.json(); } catch {}
        const code = body?.code;
        if (!code) return json(origin, 400, { error: 'Missing code' });

        // 3) Google token exchange
        const form = new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: env.OAUTH_REDIRECT_YT,
          grant_type: 'authorization_code'
        });
        const g = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form
        });
        const token = await g.json();
        if (!g.ok) return json(origin, 400, { error: 'Token exchange failed', details: token });

        // 4) Resolve Supabase user
        const u = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${userJwt}` } });
        if (!u.ok) return json(origin, 401, { error: 'Invalid Supabase session' });
        const user = await u.json();
        const userId = user?.id;
        if (!userId) return json(origin, 401, { error: 'No user id' });

        // 5) Upsert tokens
        const up = await fetch(`${env.SUPABASE_URL}/rest/v1/oauth_tokens`, {
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
            access_token: token.access_token,
            refresh_token: token.refresh_token ?? null,
            scope: token.scope ?? null,
            token_type: token.token_type ?? 'Bearer',
            expires_in: token.expires_in ?? null,
            obtained_at: new Date().toISOString()
          }])
        });
        if (!up.ok) return json(origin, 500, { error: 'Failed to store tokens', details: await up.text() });

        return json(origin, 200, { ok: true });
      } catch (e) {
        return json(origin, 500, { error: 'Server error', details: String(e) });
      }
    }

    // Static app fallback
    return env.ASSETS.fetch(request);
  }
};
