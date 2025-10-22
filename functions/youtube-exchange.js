// functions/youtube-exchange.js
// Exchanges ?code for tokens, resolves user from Supabase JWT, and persists tokens + connection flag.

const fetch = require("node-fetch");

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  OAUTH_REDIRECT_YT, // e.g. https://autostreampro.com/auth/youtube/callback
} = process.env;

// ✅ Fallback so redirect_uri always matches the authorize step
    const REDIRECT_URI = OAUTH_REDIRECT_YT || 'https://autostreampro.com/auth/youtube/callback';

function resJSON(status, body) {
  return {
    statusCode: status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return resJSON(200, {});
  if (event.httpMethod !== "POST") return resJSON(405, { error: "Method not allowed" });

  const auth = event.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return resJSON(401, { error: "Missing Authorization Bearer JWT" });
  const userJwt = auth.slice(7);

  let code;
  try {
    const body = JSON.parse(event.body || "{}");
    code = body.code;
  } catch {
    return resJSON(400, { error: "Invalid JSON body" });
  }
  if (!code) return resJSON(400, { error: "Missing code" });

  // 1) Resolve current user (from Supabase) using their JWT
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${userJwt}` },
  });
  if (!userRes.ok) return resJSON(401, { error: "Unable to resolve user" });
  const user = await userRes.json();
  const userId = user?.id;
  if (!userId) return resJSON(401, { error: "No user id" });

  // 2) Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const details = await tokenRes.text().catch(() => "");
    return resJSON(502, {
        error: "Token exchange failed",
        hint: "Check GOOGLE_CLIENT_ID/SECRET and that redirect_uri matches the one configured in Google console.",
        redirect_uri_used: REDIRECT_URI,
        details
        });
    }


  const tokens = await tokenRes.json(); // { access_token, refresh_token, expires_in, token_type, scope, id_token? }
  const now = Date.now();
  const expiresAt = tokens.expires_in ? new Date(now + tokens.expires_in * 1000).toISOString() : null;

  // 3) (Optional) Fetch profile to attach email/name
  let profile = null;
  try {
    const pr = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (pr.ok) profile = await pr.json();
  } catch {}

  // 4) Persist: youtube_tokens (secure) + mark streaming_connections.youtube_connected = true
  //    Using Supabase REST with SERVICE KEY (server-side only).
  // 4a) Upsert token row
  const upsertTok = await fetch(`${SUPABASE_URL}/rest/v1/youtube_tokens`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      user_id: userId,
      refresh_token: tokens.refresh_token || null,
      access_token: tokens.access_token || null,
      expires_at: expiresAt,
      profile,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!upsertTok.ok) return resJSON(500, { error: "Failed to save tokens", details: await upsertTok.text() });

  // 4b) Mark connection on the main table (minimal)
  const upsertConn = await fetch(`${SUPABASE_URL}/rest/v1/streaming_connections`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      user_id: userId,
      youtube_connected: true,
      youtube_connected_at: new Date().toISOString(),
    }),
  });
  if (!upsertConn.ok) return resJSON(500, { error: "Failed to mark connection", details: await upsertConn.text() });

  return resJSON(200, { ok: true });
};
