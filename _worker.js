cat > _worker.js <<'JS'
// _worker.js — stable, no-deps, cookie-based guard for /dashboard(.html)

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

    // Debug: confirm what edge sees
    if (path === '/__whoami') {
      const cookies = getCookies(req)
      const ref = getProjectRef(env.SUPABASE_URL || '')
      const cookieName = ref ? `sb-${ref}-auth-token` : null
      const authed = cookieName ? Boolean(cookies[cookieName]) : false
      return new Response(JSON.stringify({
        ok: true, authed, path, ref,
        hasUrl: !!env.SUPABASE_URL, hasAnon: !!env.SUPABASE_ANON_KEY
      }, null, 2), { headers: { 'content-type': 'application/json' } })
    }

    // Don’t intercept API or OAuth callbacks
    if (path.startsWith('/api/') || path.startsWith('/auth/')) {
      return env.ASSETS.fetch(req)
    }

    // Guard dashboards
    const protectedPaths = new Set(['/dashboard', '/dashboard.html', '/clips-dashboard', '/clips-dashboard.html'])
    const needsAuth = protectedPaths.has(path)

    // Read cookie once
    const cookies = getCookies(req)
    const ref = getProjectRef(env.SUPABASE_URL || '')
    const cookieName = ref ? `sb-${ref}-auth-token` : null
    const authed = cookieName ? Boolean(cookies[cookieName]) : false

    if (needsAuth && !authed) {
      return Response.redirect(new URL('/login', url), 302)
    }

    // Serve static
    return env.ASSETS.fetch(req)
  }
}
JS
