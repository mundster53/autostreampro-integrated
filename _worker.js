// _worker.js — Hotfix: rewrite /signup before anything; pause canonical redirect
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // --- A) REWRITE FIRST: handle pretty URLs before any redirects ---
    if ((method === 'GET' || method === 'HEAD')) {
      if (path === '/signup') {
        url.pathname = '/signup.html';
        return fetchWithCache(env, new Request(url.toString(), request));
      }
      if (path === '/dashboard') {
        url.pathname = '/dashboard.html';
        return fetchWithCache(env, new Request(url.toString(), request));
      }
    }

    // --- B) TEMPORARILY DISABLE CANONICAL 308 ---
    // const CANON = 'www.autostreampro.com';
    // const xfProto = request.headers.get('x-forwarded-proto');
    // if (url.host !== CANON || xfProto !== 'https') {
    //   url.protocol = 'https:';
    //   url.host = CANON;
    //   return Response.redirect(url.toString(), 308);
    // }

    // C) Healthcheck — never cache
    if (path === '/__whoami') {
      return new Response(JSON.stringify({ ok: true, version: 'guard-v1' }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        }
      });
    }

    // D) Auth guard for dashboard subroutes
    const cookie = request.headers.get('cookie') || '';
    const hasSupabaseAuth =
      /sb-access-token|supabase-auth-token|supabaseSession/i.test(cookie);

    if (path === '/dashboard' || path.startsWith('/dashboard/')) {
      if (!hasSupabaseAuth) {
        return new Response(null, {
          status: 302,
          headers: { 'location': '/signup', 'cache-control': 'no-store' }
        });
      }
    }

    // E) APIs/Auth → pass to Functions + no-store
    if (path.startsWith('/api/') || path.startsWith('/auth/')) {
      const resp = await env.ASSETS.fetch(request);
      const h = new Headers(resp.headers);
      h.set('cache-control', 'no-store');
      return new Response(resp.body, { status: resp.status, headers: h });
    }

    // F) Everything else
    return fetchWithCache(env, request);
  }
};

async function fetchWithCache(env, request) {
  const resp = await env.ASSETS.fetch(request);
  const h = new Headers(resp.headers);
  const ct = h.get('content-type') || '';
  if (ct.includes('text/html')) {
    h.set('cache-control', 'public, max-age=60');
  } else {
    h.set('cache-control', 'public, max-age=31536000, immutable');
  }
  return new Response(resp.body, { status: resp.status, headers: h });
}
