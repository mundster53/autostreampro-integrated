// Cloudflare Pages Function: /auth/youtube
// Builds the Google OAuth URL using env variables from CF Pages.

export async function onRequest({ request, env }) {
  // Prefer YOUTUBE_CLIENT_ID (what we put in wrangler.toml), fall back to GOOGLE_CLIENT_ID if present
  const CLIENT_ID = env.YOUTUBE_CLIENT_ID || env.GOOGLE_CLIENT_ID;
  const REDIRECT  = env.OAUTH_REDIRECT_YT         // usually https://www.autostreampro.com/auth/youtube/callback
                   || new URL('/auth/youtube/callback', request.url).toString();
  const SCOPE     = 'https://www.googleapis.com/auth/youtube.upload';
  const BASE_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';

  // Honor return_to from query (defaults to /onboarding.html)
  const url = new URL(request.url);
  const returnTo = url.searchParams.get('return_to') || '/onboarding.html';
  const state = JSON.stringify({ r: returnTo });

  if (!CLIENT_ID) {
     return new Response('Missing YOUTUBE_CLIENT_ID/GOOGLE_CLIENT_ID', { status: 500 });
   }

  const authURL = new URL(BASE_URL);
  authURL.searchParams.set('client_id', CLIENT_ID);
  authURL.searchParams.set('redirect_uri', REDIRECT);
  authURL.searchParams.set('response_type', 'code');
  authURL.searchParams.set('access_type', 'offline');
  authURL.searchParams.set('include_granted_scopes', 'true');
  authURL.searchParams.set('scope', SCOPE);
  authURL.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: { Location: authURL.toString() }
  });
}