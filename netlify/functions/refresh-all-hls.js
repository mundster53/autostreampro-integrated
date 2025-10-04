// netlify/functions/refresh-all-hls.js
// Bulk scheduled refresh (GET) and single-user on-demand refresh (POST {userId})
import { createClient } from '@supabase/supabase-js';
import { deriveKickHls, deriveTwitchHls, deriveYouTubeHls } from './_hls.js';

const PAGE_SIZE = parseInt(process.env.HLS_REFRESH_PAGE_SIZE || '200', 10);
const CONCURRENCY = parseInt(process.env.HLS_REFRESH_CONCURRENCY || '10', 10);
const REFRESH_SKEW_SEC = parseInt(process.env.HLS_REFRESH_SKEW_SEC || '120', 10); // refresh ~2 min before token exp

export const handler = async (event) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: 'Missing Supabase server envs' });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // POST { userId } -> refresh just that user
  if (event.httpMethod === 'POST') {
    try {
      const { userId } = JSON.parse(event.body || '{}');
      if (!userId) return json(400, { error: 'userId required' });

      const { data: r, error } = await supabase
        .from('ingest_router').select('*').eq('user_id', userId).single();
      if (error) return json(404, { error: error.message });

      const deriv = await deriveHls(r.platform, r.handle);
      if (!deriv?.url) {
        await markError(supabase, r.user_id, 'No HLS (offline or unsupported)');
        return json(200, { ok: true, refreshed: false });
      }

      const { error: upErr } = await supabase.from('ingest_router').update({
        hls_url: deriv.url,
        hls_exp: deriv.exp || null,
        last_seen_live: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('user_id', r.user_id);
      if (upErr) return json(500, { error: upErr.message });

      return json(200, { ok: true, refreshed: true, userId, hlsUrl: deriv.url, exp: deriv.exp || null });
    } catch (e) {
      return json(500, { error: e.message || String(e) });
    }
  }

  // GET -> scheduled bulk refresh
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });

  let offset = 0, processed = 0, refreshed = 0, lives = 0, errors = 0, pages = 0;
  for (;;) {
    const { data: rows, error } = await supabase
      .from('ingest_router').select('*')
      .order('updated_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) return json(500, { error: error.message });
    if (!rows?.length) break;
    pages++;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(chunk.map(r => refreshRow(supabase, r)));
      for (const res of results) {
        processed++;
        if (res.status === 'fulfilled') {
          const v = res.value;
          if (v === 'refreshed') { refreshed++; lives++; }
          else if (v === 'skipped') { /* noop */ }
          else if (v === 'error') { errors++; }
        } else {
          errors++;
        }
      }
    }

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return json(200, { ok: true, mode: 'bulk', pages, processed, refreshed, lives, errors });
};

// helpers
function json(code, obj) { return { statusCode: code, body: JSON.stringify(obj) }; }

async function refreshRow(supabase, r) {
  if (!r.platform || !r.handle) {
    await markError(supabase, r.user_id, 'Missing platform/handle');
    return 'error';
  }
  if (!shouldRefresh(r)) return 'skipped';

  const deriv = await deriveHls(r.platform, r.handle);
  if (!deriv?.url) {
    await markError(supabase, r.user_id, 'No HLS (offline or unsupported)');
    return 'error';
  }

  const { error: upErr } = await supabase.from('ingest_router').update({
    hls_url: deriv.url,
    hls_exp: deriv.exp || null,
    last_seen_live: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq('user_id', r.user_id);

  if (upErr) { await markError(supabase, r.user_id, upErr.message); return 'error'; }
  return 'refreshed';
}

function shouldRefresh(r) {
  if (!r.hls_url) return true;
  if (r.hls_exp) {
    try {
      const exp = new Date(r.hls_exp).getTime();
      if (exp - Date.now() <= REFRESH_SKEW_SEC * 1000) return true;
    } catch {}
  }
  const THIRTY_MIN = 30 * 60 * 1000;
  if (!r.last_seen_live) return true;
  return (Date.now() - new Date(r.last_seen_live).getTime()) > THIRTY_MIN;
}

async function markError(supabase, user_id, msg) {
  await supabase.from('ingest_router')
    .update({ last_error: msg, updated_at: new Date().toISOString() })
    .eq('user_id', user_id);
}

async function deriveHls(platform, handle) {
  const p = String(platform).toLowerCase();
  if (p === 'kick')   return deriveKickHls(handle);
  if (p === 'twitch') return deriveTwitchHls(handle);   // stub
  if (p === 'youtube')return deriveYouTubeHls(handle);  // stub
  return null;
}
