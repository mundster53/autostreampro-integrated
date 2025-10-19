// netlify/functions/youtube-auth.js
// Single-file YouTube OAuth handler (Option B + legacy POST), no 500s on Google errors.

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const REDIRECT = process.env.OAUTH_REDIRECT_YT || 'https://autostreampro.com/auth/youtube/callback';

const CORS = {
  "Access-Control-Allow-Origin": "*", // optionally pin to APP_ORIGIN after you confirm flows
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const YT_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload"
].join(" ");

function json(status, body, extra = {}) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", ...CORS, ...extra },
    body: JSON.stringify(body),
  };
}

function redirect(url) {
  return {
    statusCode: 302,
    headers: { Location: url, ...CORS },
    body: "",
  };
}

function safeReturnTo(v) {
  try {
    if (!v) return "/onboarding.html";
    const base = new URL(REDIRECT);           // derive allowed origin from REDIRECT
    const u = new URL(v, base);               // make absolute on same origin
    return u.origin === base.origin ? (u.pathname + (u.search || "")) : "/onboarding.html";
  } catch {
    return "/onboarding.html";
  }
}

function parseQuery(event) {
  const qp = new URLSearchParams(event.queryStringParameters || {});
  // Netlify already parses, but ensure string form too (for state)
  return qp;
}

async function exchangeCodeForTokens(code) {
  const params = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT,
    grant_type: "authorization_code",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  let text = "";
  try { text = await res.text(); } catch {}

  // Try to parse JSON body if present
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}

  return { ok: res.ok, status: res.status, data, text };
}

exports.handler = async (event) => {
  try {
    const { httpMethod, path } = event;

    // CORS preflight
    if (httpMethod === "OPTIONS") {
      return { statusCode: 200, headers: { ...CORS }, body: "" };
    }

    // Basic env guard (returns 500 with clear JSON, not an unhandled throw)
    if (!CLIENT_ID || !CLIENT_SECRET) {
      return json(500, { error: "server_misconfig", message: "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET" });
    }

    const qp = parseQuery(event);
    const stateRaw = qp.get("state");
    let return_to = qp.get("return_to");
    if (!return_to && stateRaw) {
      try { return_to = JSON.parse(stateRaw).r; } catch {}
    }
    const returnPath = safeReturnTo(return_to);

    // Route: start OAuth (Option B)
    if (httpMethod === "GET" && path.endsWith("/auth/youtube")) {
      const authURL = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authURL.searchParams.set("client_id", CLIENT_ID);
      authURL.searchParams.set("redirect_uri", REDIRECT);
      authURL.searchParams.set("response_type", "code");
      authURL.searchParams.set("access_type", "offline");
      authURL.searchParams.set("include_granted_scopes", "true");
      authURL.searchParams.set("scope", YT_SCOPES);
      authURL.searchParams.set("state", JSON.stringify({ r: returnPath }));
      return redirect(authURL.toString());
    }

    // Route: callback (Option B)
    if (httpMethod === "GET" && path.endsWith("/auth/youtube/callback")) {
      const code = qp.get("code");

      if (!code) {
        // Instead of 500 or re-launching OAuth, bounce with explicit error
        const u = new URL(returnPath, REDIRECT);
        u.searchParams.set("error", "missing_code");
        return redirect(u.toString());
      }

      const { ok, status, data, text } = await exchangeCodeForTokens(code);
      if (!ok || (data && data.error)) {
        const u = new URL(returnPath, REDIRECT);
        u.searchParams.set("error", (data && data.error) || "token_exchange_failed");
        u.searchParams.set("status", String(status));
        if (data && data.error_description) u.searchParams.set("desc", data.error_description.slice(0, 200));
        else if (text) u.searchParams.set("desc", text.slice(0, 200));
        return redirect(u.toString());
      }

      // At this point you have tokens. Persist them server-side if needed.
      const u = new URL(returnPath, REDIRECT);
      u.searchParams.set("ok", "1");
      return redirect(u.toString());
    }

    // Route: legacy POST with { code }
    if (httpMethod === "POST") {
      let body = {};
      try { body = JSON.parse(event.body || "{}"); } catch {}
      const code = body.code;
      const rt = safeReturnTo(body.return_to || return_to);
      if (!code) {
        return json(400, {
          error: "No authorization code provided",
          auth_url: `${new URL('/auth/youtube', REDIRECT).toString()}?return_to=${encodeURIComponent(rt)}`
        });
      }
      const { ok, status, data, text } = await exchangeCodeForTokens(code);
      if (!ok || (data && data.error)) {
        return json(400, {
          error: (data && data.error) || "token_exchange_failed",
          status,
          desc: (data && data.error_description) || (text || "").slice(0, 200)
        });
      }
      return json(200, { ok: true });
    }

    // Fallback: brief help
    return json(200, {
      ok: true,
      routes: ["/auth/youtube", "/auth/youtube/callback", "POST /.netlify/functions/youtube-auth"],
    });
  } catch (err) {
    // Final safety net: never leak stack to users
    return json(500, { error: "internal_error" });
  }
};
