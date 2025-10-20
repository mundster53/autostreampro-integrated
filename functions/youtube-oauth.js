console.log("🚀 HIT youtube-oauth.js");


// netlify/functions/youtube-oauth.js
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const REDIRECT = process.env.OAUTH_REDIRECT_YT || 'https://autostreampro.com/auth/youtube/callback';
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const BASE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  try {
    // Get where to return after auth
    const url = new URL(event.rawUrl);
    const returnTo = url.searchParams.get('return_to') || '/onboarding.html';
    const state = JSON.stringify({ r: returnTo });

    // Build Google OAuth URL
    const authURL = new URL(BASE_URL);
    authURL.searchParams.set('client_id', CLIENT_ID);
    authURL.searchParams.set('redirect_uri', REDIRECT);
    authURL.searchParams.set('response_type', 'code');
    authURL.searchParams.set('access_type', 'offline');
    authURL.searchParams.set('include_granted_scopes', 'true');
    authURL.searchParams.set('scope', SCOPE);
    authURL.searchParams.set('state', state);

    return {
      statusCode: 302,
      headers: { Location: authURL.toString() },
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
