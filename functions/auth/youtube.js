// Native Cloudflare Pages Function for /auth/youtube
// Mirrors your Netlify youtube-oauth.js behavior.
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const returnTo = url.searchParams.get('return_to') || '/onboarding.html';

  const CLIENT_ID = env.GOOGLE_CLIENT_ID;
  const REDIRECT  = env.OAUTH_REDIRECT_YT || 'https://autostreampro.com/auth/youtube/callback';
  const SCOPE     = 'https://www.googleapis.com/auth/youtube.upload';
  const BASE_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';

  // Build ?state with where to return after callback
  const state = JSON.stringify({ r: returnTo });

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