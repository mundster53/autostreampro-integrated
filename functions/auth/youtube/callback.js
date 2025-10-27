// Native Cloudflare Pages Function for /auth/youtube/callback

export async function onRequest({ request }) {
   try {
      // …rest unchanged…
    const url   = new URL(request.url);
    const code  = url.searchParams.get('code') || '';
    const error = url.searchParams.get('error') || '';
    const rawState = url.searchParams.get('state') || '';

    // Default return page (you asked to land on onboarding.html)
    let returnTo = '/onboarding.html';
    if (rawState) {
      try {
        // state is decoded already by searchParams
        const parsed = JSON.parse(rawState);
        if (parsed && typeof parsed.r === 'string' && parsed.r.startsWith('/')) {
          returnTo = parsed.r;
        }
      } catch {
        // ignore malformed state; fall back to default returnTo
      }
    }

    if (error) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${returnTo}?youtube_error=${encodeURIComponent(error)}` }
      });
    }
    if (!code) {
      return new Response('Missing OAuth code', { status: 400 });
    }

    // Bounce back with the temporary code (your page will exchange it if needed)
    return new Response(null, {
      status: 302,
      headers: { Location: `${returnTo}?youtube_code=${encodeURIComponent(code)}` }
    });
  } catch (e) {
    // Surface the error to help us debug locally
    return new Response(`Callback error: ${e?.message || e}`, { status: 500 });
  }
}
