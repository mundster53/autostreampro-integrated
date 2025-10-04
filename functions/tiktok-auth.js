// netlify/functions/tiktok-auth.js
//
// Handles BOTH routes via your existing redirects:
//   GET /auth/tiktok                -> builds TikTok OAuth URL (start)
//   GET /auth/tiktok/callback?code -> exchanges code, stores tokens, enables Direct Post if requested
//
// Required env vars (set in Netlify):
//   TIKTOK_CLIENT_ID
//   TIKTOK_CLIENT_SECRET
//   TIKTOK_REDIRECT_URI   (e.g., https://autostreampro.com/auth/tiktok/callback)
// Optional env vars:
//   TIKTOK_API_BASE       (default: https://open.tiktokapis.com)
//   TIKTOK_SCOPES_BASE    (default used below: "user.info.basic video.upload video.publish")
//   TIKTOK_SCOPES_DIRECT  (extra scopes if your app has Direct Post product; may be empty)
//
// Depends on: netlify/functions/_shared/supabase.js (service role client)

import fetch from 'node-fetch';
import { supabase } from './_shared/supabase.js';

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') {
      return json(405, { error: 'Method Not Allowed' });
    }

    const qs = event.queryStringParameters || {};
    // If TikTok sent us back with a code, treat as callback
    if (qs.code) {
      return await handleCallback(qs);
    }
    // Otherwise, start auth
    return await handleStart(qs);
  } catch (err) {
    return redirect(withError('/onboarding-wizard.html#tiktok', 'unexpected_error'));
  }
};

/* -------------------------------
 * Start: build TikTok authorize URL
 * ----------------------------- */
async function handleStart(qs) {
  const user = qs.user;                      // required: your user's UUID
  const direct = qs.direct === '1';          // optional: request Direct Post enablement
  const returnTo = normalizeReturn(qs.return_to) || '/onboarding-wizard.html#tiktok';

  if (!user) return json(400, { error: 'Missing user id' });

  const clientId    = process.env.TIKTOK_CLIENT_ID;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;
  const baseScopes  = (process.env.TIKTOK_SCOPES_BASE || 'user.info.basic video.upload video.publish').trim();
  const directScopes= (process.env.TIKTOK_SCOPES_DIRECT || '').trim();
  const scopes      = (baseScopes + (direct && directScopes ? ' ' + directScopes : '')).trim();

  if (!clientId || !redirectUri || !scopes) {
    return json(500, { error: 'Missing TikTok OAuth env vars' });
  }

  const state = base64urlEncode(JSON.stringify({ user, direct: direct ? 1 : 0, return_to: returnTo }));

  // TikTok OAuth v2 authorize endpoint
  const authorizeUrl = new URL('https://www.tiktok.com/v2/auth/authorize/');
  authorizeUrl.searchParams.set('client_key', clientId);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', scopes);
  authorizeUrl.searchParams.set('state', state);

  return redirect(authorizeUrl.toString());
}

/* ---------------------------------
 * Callback: exchange code, upsert DB
 * ------------------------------- */
async function handleCallback(qs) {
  const code  = qs.code;
  const state = qs.state || '';
  const stateObj = safeParseState(state);
  const userId   = stateObj.user;
  const directReq= !!stateObj.direct;
  const returnTo = normalizeReturn(stateObj.return_to) || '/onboarding-wizard.html#tiktok';

  if (!code || !userId) {
    return redirect(returnTo);
  }

  const base         = process.env.TIKTOK_API_BASE || 'https://open.tiktokapis.com';
  const clientId     = process.env.TIKTOK_CLIENT_ID;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri  = process.env.TIKTOK_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return redirect(withError(returnTo, 'missing_env'));
  }

  // (1) Exchange code -> tokens
  const tokenRes = await fetch(`${base}/v2/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    })
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenJson?.access_token) {
    return redirect(withError(returnTo, 'token_exchange_failed'));
  }

  const accessToken = tokenJson.access_token;
  const refreshToken = tokenJson.refresh_token || null;
  const expiresIn = Number(tokenJson.expires_in || 0);
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

  // (2) Fetch user info to get open_id (platform_user_id)
  const infoRes = await fetch(`${base}/v2/user/info/?fields=open_id,display_name`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const infoJson = await infoRes.json().catch(() => ({}));
  const platformUserId = infoJson?.data?.user?.open_id || infoJson?.data?.open_id || null;

  // (3) Upsert streaming_connections for (user, 'tiktok')
  const upsert = {
    user_id: userId,
    platform: 'tiktok',
    platform_user_id: platformUserId,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    is_active: true
  };
  if (directReq) {
    upsert.direct_post_enabled = true;
    upsert.direct_post_approved_at = new Date().toISOString();
  }

  const { error: upErr } = await supabase
    .from('streaming_connections')
    .upsert(upsert, { onConflict: 'user_id,platform' });

  if (upErr) {
    return redirect(withError(returnTo, 'db_upsert_failed'));
  }

  return redirect(returnTo);
}

/* ----------------
 * helpers
 * -------------- */
function json(statusCode, obj) {
  return { statusCode, body: JSON.stringify(obj) };
}
function redirect(url) {
  return { statusCode: 302, headers: { Location: url }, body: '' };
}
function withError(u, code) {
  const url = new URL(normalizeReturn(u), 'https://autostreampro.com');
  url.searchParams.set('err', code);
  return url.pathname + url.search + url.hash;
}
function normalizeReturn(u) {
  if (!u || typeof u !== 'string') return '';
  try {
    // allow only site-internal paths (avoid open redirects)
    const url = new URL(u, 'https://autostreampro.com');
    return url.pathname + url.search + url.hash;
  } catch {
    return '';
  }
}
function base64urlEncode(s) {
  return Buffer.from(s, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
}
function base64urlDecode(s) {
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  return Buffer.from(b64, 'base64').toString('utf8');
}
function safeParseState(state) {
  try { return JSON.parse(base64urlDecode(state)); } catch { return {}; }
}
