// Vercel Serverless Function: /api/auth/youtube
// Builds the Google OAuth URL and redirects user to Google

export default async function handler(req, res) {
  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const REDIRECT = process.env.OAUTH_REDIRECT_YT || 'https://www.autostreampro.com/auth/youtube.html';
  const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
  const BASE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

  // Honor return_to from query (defaults to /onboarding.html)
  const returnTo = req.query.return_to || '/onboarding.html';
  const state = JSON.stringify({ r: returnTo });

  if (!CLIENT_ID) {
    return res.status(500).json({ error: 'Missing GOOGLE_CLIENT_ID' });
  }

  const authURL = new URL(BASE_URL);
  authURL.searchParams.set('client_id', CLIENT_ID);
  authURL.searchParams.set('redirect_uri', REDIRECT);
  authURL.searchParams.set('response_type', 'code');
  authURL.searchParams.set('access_type', 'offline');
  authURL.searchParams.set('include_granted_scopes', 'true');
  authURL.searchParams.set('scope', SCOPE);
  authURL.searchParams.set('state', state);

  // Redirect to Google OAuth
  res.redirect(302, authURL.toString());
}