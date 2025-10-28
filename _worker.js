// _worker.js — “No-redirect” hard fix for /signup 308 loops
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // A) REWRITE/ SERVE FIRST — never redirect /signup
    if (method === 'GET' || method === 'HEAD') {
      if (path === '/signup' || path === '/signup/') {
        return serveFile(env, request, '/signup.html'); // 200, no redirect
      }
      if (path === '/dashboard') {
        // We'll serve /dashboard.html only after auth check below.
        // Do nothing here so guard can run first.
      }
    }

    // B) Healthcheck — never cache
    if (path === '/__whoami') {
      return new Response(JSON.stringify({ ok: true, version: 'guard-v1' }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        }
      });
    }

    // C) Auth guard for /dashboard*
    const cookie = request.headers.get('cookie') || '';
    const hasSupabaseAuth = /sb-access-token|supabase-auth-token|supabaseSession/i.test(cookie);

    if (path === '/dashboard' || path.startsWith('/dashboard/')) {
      if (!hasSupabaseAuth) {
        // 302 is fine; the target (/signup) is now a 200 with no redirect.
        return new Response(null, {
          status: 302,
          headers: { 'location': '/signup', 'cache-control': 'no-store' }
        });
      }
      // Authed → serve dashboard.html as 200 (no rewrite redirects)
      if (method === 'GET' || method === 'HEAD') {
        return serveFile(env, request, '/dashboard.html');
      }
    }

    // D) APIs/Auth → pass to Functions + no-store
    if (path.startsWith('/api/') || path.startsWith('/auth/')) {
      const resp = await env.ASSETS.fetch(request);
      const h = new Headers(resp.headers);
      h.set('cache-control', 'no-store');
      return new Response(resp.body, { status: resp.status, headers: h });
    }

    // E) Everything else → normal Pages fetch with smart cache
    return fetchWithCache(env, request);
  }
};

async function serveFile(env, request, assetPath) {
  // Internal fetch for a specific file; returns 200, no redirect.
  const fileURL = new URL(assetPath, request.url);
  const internalReq = new Request(fileURL.toString(), {
    method: 'GET',
    headers: request.headers
  });
  const resp = await env.ASSETS.fetch(internalReq);
  const h = new Headers(resp.headers);
  setSmartCache(h);
  // Marker header to help us debug:
  h.set('x-asp-serve', assetPath);
  return new Response(resp.body, { status: 200, headers: h });
}

async function fetchWithCache(env, request) {
  const resp = await env.ASSETS.fetch(request);
  const h = new Headers(resp.headers);
  setSmartCache(h);
  return new Response(resp.body, { status: resp.status, headers: h });
}

function setSmartCache(h) {
  const ct = h.get('content-type') || '';
  if (ct.includes('text/html')) {
    h.set('cache-control', 'public, max-age=60');
  } else {
    h.set('cache-control', 'public, max-age=31536000, immutable');
  }
}
