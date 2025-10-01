// functions/add-kick-channel.js
// Writes/updates streaming_connections safely and then flips ingest to this user.
// Handles the global unique constraint on (platform, lower(platform_username)) by
// detecting an existing row for the same handle and PATCHing it instead of INSERT.

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_SECRET } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY'
        })
      };
    }

    const body = JSON.parse(event.body || '{}');
    const userId = String(body.userId || '').trim();
    const rawUsernameInput = String(body.kickUsername || body.platform_user_id || '').trim();
    if (!userId || !rawUsernameInput) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing userId or kickUsername' }) };
    }

    const platform = 'kick';
    // normalize for storage/compare
    const normalizedUsername = rawUsernameInput.toLowerCase().replace(/[^a-z0-9._-]/g, '');
    const rawUsername = rawUsernameInput; // keep original case for any display column

    // ── Helpers
    const gqlHeaders = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    };
    const restHeaders = gqlHeaders;

    // ───────────────────────────────────────────────────────────────────────────
    // 1) Introspect columns (so we only write what exists)
    // ───────────────────────────────────────────────────────────────────────────
    const introspect = async () => {
      let cols = null;
      const q1 = await fetch(`${SUPABASE_URL}/graphql/v1`, {
        method: 'POST',
        headers: gqlHeaders,
        body: JSON.stringify({
          query: `{
            __type(name: "streaming_connections") {
              name
              fields { name }
            }
          }`
        })
      }).then(r => r.json()).catch(() => null);

      if (q1?.data?.__type?.fields) {
        cols = new Set(q1.data.__type.fields.map(f => f.name));
      } else {
        const q2 = await fetch(`${SUPABASE_URL}/graphql/v1`, {
          method: 'POST',
          headers: gqlHeaders,
          body: JSON.stringify({
            query: `{
              __schema { types { name kind fields { name } } }
            }`
          })
        }).then(r => r.json()).catch(() => null);
        if (q2?.data?.__schema?.types) {
          const t = q2.data.__schema.types.find(
            tt => tt && tt.name === 'streaming_connections' && tt.fields
          );
          if (t) cols = new Set(t.fields.map(f => f.name));
        }
      }
      if (!cols) throw new Error('Could not introspect streaming_connections schema');
      return cols;
    };

    const columns = await introspect();

    // ───────────────────────────────────────────────────────────────────────────
    // 2) Build payload for write
    // ───────────────────────────────────────────────────────────────────────────
    const payload = {};
    if (columns.has('user_id')) payload.user_id = userId;
    if (columns.has('platform')) payload.platform = platform;
    if (columns.has('platform_user_id')) payload.platform_user_id = normalizedUsername;
    if (columns.has('is_active')) payload.is_active = true;
    if (columns.has('updated_at')) payload.updated_at = new Date().toISOString();

    // Optional display column (best match)
    const usernameCandidateColumns = [
      'username', 'platform_username', 'display_name',
      'channel_username', 'channel_title', 'name'
    ];
    const nameCol = usernameCandidateColumns.find(c => columns.has(c));
    if (nameCol) payload[nameCol] = rawUsername;

    // ───────────────────────────────────────────────────────────────────────────
    // 3) Find existing row EITHER by (user_id, platform) OR by handle (global)
    //    to avoid unique errors and to enable "last onboarded wins" reassignment.
    // ───────────────────────────────────────────────────────────────────────────
    const fetchOne = async (url) => {
      const r = await fetch(url, { headers: restHeaders });
      if (!r.ok) throw new Error(`Supabase HTTP ${r.status}: ${await r.text()}`);
      const arr = await r.json();
      return Array.isArray(arr) && arr.length ? arr[0] : null;
    };

    // existing for this user/platform?
    let existing = null;
    if (columns.has('user_id') && columns.has('platform')) {
      const u = `${SUPABASE_URL}/rest/v1/streaming_connections?user_id=eq.${encodeURIComponent(
        userId
      )}&platform=eq.${platform}&select=id,user_id,platform,platform_user_id${nameCol ? `,${nameCol}` : ''}`;
      existing = await fetchOne(u).catch(() => null);
    }

    // If not found, look up by handle (global unique across platform)
    let existingByHandle = null;
    // by platform_user_id (normalized)
    if (columns.has('platform_user_id')) {
      const u = `${SUPABASE_URL}/rest/v1/streaming_connections?platform=eq.${platform}&platform_user_id=eq.${encodeURIComponent(
        normalizedUsername
      )}&select=id,user_id,platform,platform_user_id${nameCol ? `,${nameCol}` : ''}`;
      existingByHandle = await fetchOne(u).catch(() => null);
    }
    // if still not found and we have a display username column, try that too (raw & normalized)
    if (!existingByHandle && nameCol) {
      const u1 = `${SUPABASE_URL}/rest/v1/streaming_connections?platform=eq.${platform}&${nameCol}=eq.${encodeURIComponent(
        rawUsername
      )}&select=id,user_id,platform,platform_user_id${nameCol ? `,${nameCol}` : ''}`;
      existingByHandle = await fetchOne(u1).catch(() => null);
      if (!existingByHandle && rawUsername.toLowerCase() !== normalizedUsername) {
        const u2 = `${SUPABASE_URL}/rest/v1/streaming_connections?platform=eq.${platform}&${nameCol}=eq.${encodeURIComponent(
          normalizedUsername
        )}&select=id,user_id,platform,platform_user_id${nameCol ? `,${nameCol}` : ''}`;
        existingByHandle = await fetchOne(u2).catch(() => null);
      }
    }

    // Choose which record to update/insert
    let targetId = existing?.id || existingByHandle?.id || null;
    let reassignedFromUserId = null;
    if (!targetId && existingByHandle?.id) {
      targetId = existingByHandle.id;
    }
    if (targetId && existingByHandle && existingByHandle.user_id && existingByHandle.user_id !== userId) {
      // ownership transfer (MVP: last onboarded wins)
      reassignedFromUserId = existingByHandle.user_id;
    }

    // ───────────────────────────────────────────────────────────────────────────
    // 4) Write: PATCH (if targetId) else INSERT
    // ───────────────────────────────────────────────────────────────────────────
    let writeRes;
    if (targetId) {
      // ensure payload includes our normalized + display + new user_id
      const patchBody = { ...payload };
      if (columns.has('user_id')) patchBody.user_id = userId;
      writeRes = await fetch(
        `${SUPABASE_URL}/rest/v1/streaming_connections?id=eq.${targetId}`,
        {
          method: 'PATCH',
          headers: { ...restHeaders, Prefer: 'return=representation' },
          body: JSON.stringify(patchBody)
        }
      );
    } else {
      // fresh insert
      if (!payload.user_id || !payload.platform) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            success: false,
            error: 'Table appears to be missing user_id or platform columns for insert'
          })
        };
      }
      writeRes = await fetch(`${SUPABASE_URL}/rest/v1/streaming_connections`, {
        method: 'POST',
        headers: { ...restHeaders, Prefer: 'return=representation' },
        body: JSON.stringify(payload)
      });
    }

    if (!writeRes.ok) {
      const txt = await writeRes.text();
      return { statusCode: 500, body: JSON.stringify({ success: false, error: txt }) };
    }

    const data = await writeRes.json();
    const connection = data[0] || null;

    // ───────────────────────────────────────────────────────────────────────────
    // 5) Flip ingest to THIS user (server→server; single call; non-fatal)
    // ───────────────────────────────────────────────────────────────────────────
    let ingest = null;
    let ingestError = null;
    try {
      const base = (
        process.env.SITE_URL ||
        process.env.URL ||
        process.env.DEPLOY_PRIME_URL ||
        ''
      ).replace(/\/$/, '');

      if (base) {
        const headers = { 'Content-Type': 'application/json' };
        if (ADMIN_SECRET) headers['x-admin-secret'] = ADMIN_SECRET;

        const res = await fetch(`${base}/.netlify/functions/set-ingest-source`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ userId }) // no hard-coding; function will look up the handle
        });

        const txt = await res.text();
        const json = (res.headers.get('content-type') || '').includes('application/json')
          ? JSON.parse(txt) : { raw: txt };

        if (res.ok) ingest = json;
        else ingestError = json?.error || json?.message || txt || `HTTP ${res.status}`;
      } else {
        ingestError = 'No site base URL available to call set-ingest-source';
      }
    } catch (e) {
      ingestError = e?.message || String(e);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        connection,
        reassignedFromUserId: reassignedFromUserId || undefined,
        ingest: ingest || undefined,
        ingestError: ingestError || undefined
      })
    };
  } catch (err) {
    console.error('add-kick-channel error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
