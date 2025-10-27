// _worker.js
import { createServerClient } from '@supabase/ssr'

const ORIGINS = ['https://www.autostreampro.com']

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    // Special: quick debug endpoint to see session visibility from the edge
    if (path === '/__whoami') {
      const { session } = await getSessionFromCookies(req, env)
      return json(
        {
          host: url.host,
          path,
          authed: !!session,
          // cookie names only (no values) to confirm what the browser sent
          cookies: (req.headers.get('Cookie') || '')
            .split(';')
            .map(s => s.trim())
            .filter(Boolean)
            .map(kv => kv.split('=')[0])
        },
        200,
        { 'x-asp-edge': '1', 'x-asp-authed': String(!!session), 'x-asp-route': path }
      )
    }

    // Handle CORS preflight for static assets (API functions handle their own OPTIONS)
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
          'x-asp-authed': 'n/a',
          'x-asp-route': path
        },
      })
    }

    // Never intercept API or OAuth callback routes
    if (path.startsWith('/api/') || path.startsWith('/auth/')) {
      const res = await env.ASSETS.fetch(req)
      return withDebugHeaders(res, { authed: 'n/a', route: path })
    }

    // Read Supabase session once at the edge
    const { session, setCookies } = await getSessionFromCookies(req, env)

    // Edge auth routing (expand 'needsAuth' set as you add protected pages)
    const isLogin = path === '/login' || path === '/login.html'
    const protectedPaths = new Set(['/dashboard', '/dashboard.html'])
    const needsAuth = protectedPaths.has(path)

    if (!session && needsAuth) {
      return redirectWithCookies(setCookies, new URL('/login', url).toString(), {
        'x-asp-edge': '1',
        'x-asp-authed': 'false',
        'x-asp-route': path
      })
    }
    if (session && isLogin) {
      return redirectWithCookies(setCookies, new URL('/dashboard.html', url).toString(), {
        'x-asp-edge': '1',
        'x-asp-authed': 'true',
        'x-asp-route': path
      })
    }

    // Serve static asset; forward any Set-Cookie headers we captured + debug headers
    const res = await env.ASSETS.fetch(req)
    const h = new Headers(res.headers)
    if (setCookies.length) setCookies.forEach(v => h.append('Set-Cookie', v))
    h.set('x-asp-edge', '1')
    h.set('x-asp-authed', String(!!session))
    h.set('x-asp-route', path)
    return new Response(res.body, { status: res.status, headers: h })
  },
}

async function getSessionFromCookies(req, env) {
  const setCookies = []
  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        const raw = req.headers.get('Cookie') ?? ''
        return raw
          .split(';')
          .map(v => v.trim())
          .filter(Boolean)
          .map(kv => {
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
  } catch (_) {
    // fail-open: session remains null
  }
  return { session, setCookies }
}

function redirectWithCookies(setCookies, location, extraHeaders = {}) {
  const h = new Headers({ Location: location, ...extraHeaders })
  setCookies.forEach(v => h.append('Set-Cookie', v))
  return new Response(null, { status: 302, headers: h })
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function withDebugHeaders(res, { authed, route }) {
  const h = new Headers(res.headers)
  h.set('x-asp-edge', '1')
  h.set('x-asp-authed', String(authed))
  h.set('x-asp-route', route)
  return new Response(res.body, { status: res.status, headers: h })
}
