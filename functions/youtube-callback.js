// functions/youtube-callback.js
// Minimal callback: just bounce back to the wizard with the ?youtube_code
// (You can swap this later for a full token exchange.)

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };

  const qs = event.queryStringParameters || {};
  const code = qs.code || "";
  const error = qs.error || "";

  // parse return target from state; default to /onboarding.html
  let returnTo = "/onboarding.html";
  try {
    if (qs.state) {
      const parsed = JSON.parse(qs.state);
      if (parsed && typeof parsed.r === "string" && parsed.r.startsWith("/")) {
        returnTo = parsed.r;
       }
    }
   } catch {}

  // If Google sent an error, surface it in the UI for now.
  if (error) {
    return {
      statusCode: 302,
      headers: { Location: `${returnTo}?youtube_error=${encodeURIComponent(error)}` },
      body: ""
    };
  }

  if (!code) {
    return { statusCode: 400, body: "Missing OAuth code" };
  }

  // Round-trip to your UI. Later, the UI will POST this code/nonce to your backend with JWT.
  return {
    statusCode: 302,
    headers: { Location: `${returnTo}?youtube_code=${encodeURIComponent(code)}` },
    body: ""
  };
};
