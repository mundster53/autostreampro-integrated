import { createServerClient } from '@supabase/ssr'

const ORIGINS = ['https://www.autostreampro.com']

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    // Debug endpoint to confirm Worker + session
    if (path === '/__whoami') {
      const { session } = await getSessionFromCookies(req, env)
      return new Response(JSON.stringify({ authed: !!session, path }, null, 2), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-asp-edge': '1' }
      })
    }

    // CORS preflight for static (API functions handle their own)
    if (req.method === 'OPTIONS') {
      const origin = req.headers.get('Origin') || ''
      const allow = ORIGINS.includes(origin) ? origin : ORIGINS[0]
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': allow,
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Cache-Control': 'no-store',
          'x-asp-edge': '1',
        },
      })
    }

    // Never intercept API or OAuth callback routes
    if (path.startsWith('/api/') || path.startsWith('/auth/')) {
      const res = await env.ASSETS.fetch(req)
      const h = new Headers(res.headers); h.set('x-asp-edge', '1')
      return new Response(res.body, { status: res.status, headers: h })
    }

    // Read Supabase session once
    const { session, setCookies } = await getSessionFromCookies(req, env)

    // Protect dashboard only; DO NOT auto-redirect /login (prevents loop)
    const protectedPaths = new Set(['/dashboard', '/dashboard.html'])
    const needsAuth = protectedPaths.has(path)

    if (!session && needsAuth) {
      return redirectWithCookies(setCookies, new URL('/login', url).toString())
    }

    // Serve static asset and forward any Set-Cookie + debug header
    const res = await env.ASSETS.fetch(req)
    const h = new Headers(res.headers)
    h.set('x-asp-edge', '1')
    if (setCookies.length) setCookies.forEach(v => h.append('Set-Cookie', v))
    return new Response(res.body, { status: res.status, headers: h })
  },
}

async function getSessionFromCookies(req, env) {
  const setCookies = []
  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        const raw = req.headers.get('Cookie') ?? ''
        return raw.split(';').map(v => v.trim()).filter(Boolean).map(kv => {
          const i = kv.indexOf('=')
          return { name: decodeURIComponent(kv.slice(0, i)), value: decodeURIComponent(kv.slice(i + 1)) }
        })
      },
      setAll(cookies) {
        for (const { name, value, options } of cookies) {
          const parts = [`${name}=${value}`]
          if (options?.path) parts.push(`Path=${options.path}`)
          if (options?.domain) parts.push(`Domain=${options.domain}`)
          if (options?.maxAge) parts.push(`Max-Age=${options.maxAge}`)
          if (options?.expires) parts.push(`Expires=${new Date(options.expires).toUTCString()}`)
          if (options?.sameSite) parts.push(`SameSite=${options.sameSite}`)
          if (options?.secure) parts.push('Secure')
          if (options?.httpOnly) parts.push('HttpOnly')
          setCookies.push(parts.join('; '))
        }
      },
    },
  })
  let session = null
  try {
    const { data } = await supabase.auth.getSession()
    session = data?.session ?? null
  } catch {}
  return { session, setCookies }
}

function redirectWithCookies(setCookies, location) {
  const h = new Headers({ Location: location, 'x-asp-edge': '1' })
  setCookies.forEach(v => h.append('Set-Cookie', v))
  return new Response(null, { status: 302, headers: h })
}
