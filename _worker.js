// _worker.js
import { createServerClient } from '@supabase/ssr'

// Hosts you allow for CORS/preflight responses.
// Now that apex 301 → www, you can keep just the www origin.
const ORIGINS = ['https://www.autostreampro.com']

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    // Handle CORS preflight for static responses (API funcs handle their own)
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
        },
      })
    }

    // Never intercept API or auth callback routes
    if (path.startsWith('/api/') || path.startsWith('/auth/')) {
      return env.ASSETS.fetch(req)
    }

    // Supabase server client wired to request cookies
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

    // One authoritative read of the session
    let session = null
    try {
      const { data } = await supabase.auth.getSession()
      session = data?.session ?? null
    } catch {
      // If Supabase is unreachable, fail open and serve asset (avoids loops)
    }

    // Auth routing rules at the edge
    const isLogin = path === '/login' || path === '/login.html'
    const isDash  = path === '/dashboard' || path === '/dashboard.html'
    const needsAuth = isDash // add more protected paths as needed

    if (!session && needsAuth) {
      return redirectWithCookies(setCookies, new URL('/login', url).toString())
    }
    if (session && isLogin) {
      return redirectWithCookies(setCookies, new URL('/dashboard.html', url).toString())
    }

    // Serve the static asset and forward any Set-Cookie headers
    const res = await env.ASSETS.fetch(req)
    if (setCookies.length) {
      const h = new Headers(res.headers)
      setCookies.forEach(v => h.append('Set-Cookie', v))
      return new Response(res.body, { status: res.status, headers: h })
    }
    return res
  },
}

function redirectWithCookies(setCookies, location) {
  const h = new Headers({ Location: location })
  setCookies.forEach(v => h.append('Set-Cookie', v))
  return new Response(null, { status: 302, headers: h })
}
