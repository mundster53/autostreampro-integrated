// netlify/functions/_hls.js
// Shared HLS derivation utilities for all platforms

export async function deriveKickHls(handle) {
  const url = `https://kick.com/api/v2/channels/${encodeURIComponent(handle)}/livestream`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) return null;

  const j = await res.json();
  const raw = j?.playback_url || j?.data?.playback_url || j?.livestream?.playback_url;
  if (!raw) return null;

  const hls = String(raw).replace(/\\\//g, '/');

  // Try to parse JWT exp from ?token=
  let exp = null;
  try {
    const u = new URL(hls);
    const token = u.searchParams.get('token');
    if (token) {
      const payloadB64 = token.split('.')[1];
      const json = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
      if (typeof json.exp === 'number') exp = new Date(json.exp * 1000).toISOString();
    }
  } catch { /* ignore */ }

  return { url: hls, exp };
}

// TODO: wire later
export async function deriveTwitchHls(_handle) { return null; }
export async function deriveYouTubeHls(_handle) { return null; }
