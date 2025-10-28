// _worker.js — stable, no-deps, serves assets + guards /dashboard(.html)

function getProjectRef(url) {
  try { return new URL(url).hostname.split('.')[0] } catch { return '' }
}
function getCookies(req) {
  const raw = req.headers.get('Cookie') || ''
  const out = {}
  for (const part of raw.split(';')) {
    const p = part.trim()
    if (!p) continue
    const i = p.indexOf('=')
    if (i > 0) out[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1))
  }
  return out
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

// CORS preflight for any /api/* endpoint
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': 'https://www.autostreampro.com',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Cache-Control': 'no-store',
        },
      })
    }

    // Debug: confirm edge sees cookies / env
    if (path === '/__whoami') {
      const cookies = getCookies(req)
      const ref = getProjectRef(env.SUPABASE_URL || '')
      const cookieName = ref ? `sb-${ref}-auth-token` : null
      const authed = cookieName ? Boolean(cookies[cookieName]) : false
      return new Response(JSON.stringify({
        ok: true,
        version: "guard-v1",
        authed, path, ref,
        hasUrl: !!env.SUPABASE_URL,
        hasAnon: !!env.SUPABASE_ANON_KEY
      }, null, 2), { headers: { 'content-type': 'application/json' } })
    }

    // Let API and OAuth callbacks bypass the guard
    if (path.startsWith('/api/') || path.startsWith('/auth/')) {
      return env.ASSETS.fetch(req)
    }

    // Protect dashboards (signed-out -> /login)
    const protectedPaths = new Set(['/dashboard', '/dashboard.html', '/clips-dashboard', '/clips-dashboard.html'])
    const needsAuth = protectedPaths.has(path)

    const cookies = getCookies(req)
    const ref = getProjectRef(env.SUPABASE_URL || '')
    const cookieName = ref ? `sb-${ref}-auth-token` : null
    const authed = cookieName ? Boolean(cookies[cookieName]) : false

    if (needsAuth && !authed) {
      return Response.redirect(new URL('/login', url), 302)
    }

// Hard-stop any external clean-URL redirect on login
    if (path === '/login' || path === '/login.html') {
    const u = new URL(url); u.pathname = '/login.html'
    return env.ASSETS.fetch(new Request(u, req))
}

    // Serve static asset (HTML/CSS/JS from your repo)
    return env.ASSETS.fetch(req)
  }
}
