// functions/add-kick-channel.js
// Dynamically inspects the `streaming_connections` columns via Supabase GraphQL,
// writes only to columns that exist, then (on success) tells ingest to point at this user.

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables'
        })
      };
    }

    const body = JSON.parse(event.body || '{}');
    const userId = String(body.userId || '').trim();
    const rawUsername = String(body.kickUsername || '').trim();
    if (!userId || !rawUsername) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing userId or kickUsername' }) };
    }

    const platform = 'kick';
    const normalizedUsername = rawUsername.toLowerCase().replace(/[^a-z0-9._-]/g, '');

    // ─────────────────────────────────────────────────────────────────────────────
    // 1) Introspect columns on `streaming_connections` using Supabase GraphQL
    // ─────────────────────────────────────────────────────────────────────────────
    const gqlHeaders = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    };

    // Try direct type lookup first
    let columns = null;
    let gql = await fetch(`${SUPABASE_URL}/graphql/v1`, {
      method: 'POST',
      headers: gqlHeaders,
      body: JSON.stringify({
        query: `
          {
            __type(name: "streaming_connections") {
              name
              fields { name }
            }
          }
        `
      })
    }).then(r => r.json()).catch(() => null);

    if (gql && gql.data && gql.data.__type && gql.data.__type.fields) {
      columns = new Set(gql.data.__type.fields.map(f => f.name));
    }

    // Fallback: scan the schema for a type named "streaming_connections" (safer)
    if (!columns) {
      gql = await fetch(`${SUPABASE_URL}/graphql/v1`, {
        method: 'POST',
        headers: gqlHeaders,
        body: JSON.stringify({
          query: `
            {
              __schema {
                types {
                  name
                  kind
                  fields { name }
                }
              }
            }
          `
        })
      }).then(r => r.json()).catch(() => null);

      if (gql && gql.data && gql.data.__schema && Array.isArray(gql.data.__schema.types)) {
        const t = gql.data.__schema.types.find(tt => tt && tt.name === 'streaming_connections' && tt.fields);
        if (t) columns = new Set(t.fields.map(f => f.name));
      }
    }

    if (!columns) {
      return {
        statusCode: 500,
        body: JSON.stringify({ success: false, error: 'Could not introspect streaming_connections schema' })
      };
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 2) Build a payload that ONLY includes columns that exist
    // ─────────────────────────────────────────────────────────────────────────────
    const payload = {};
    if (columns.has('user_id')) payload.user_id = userId;
    if (columns.has('platform')) payload.platform = platform;
    if (columns.has('platform_user_id')) payload.platform_user_id = normalizedUsername;
    if (columns.has('is_active')) payload.is_active = true;
    if (columns.has('updated_at')) payload.updated_at = new Date().toISOString();

    // Try to store the display name in the best-matching column
    const usernameCandidateColumns = [
      'username', 'platform_username', 'display_name',
      'channel_username', 'channel_title', 'name'
    ];
    const nameCol = usernameCandidateColumns.find(c => columns.has(c));
    if (nameCol) payload[nameCol] = rawUsername;

    // ─────────────────────────────────────────────────────────────────────────────
    // 3) Upsert-style write via Supabase REST
    // ─────────────────────────────────────────────────────────────────────────────
    const restHeaders = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    };

    // Find existing connection
    let existingId = null;
    if (columns.has('user_id') && columns.has('platform')) {
      const sel = await fetch(
        `${SUPABASE_URL}/rest/v1/streaming_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.${platform}&select=id`,
        { headers: restHeaders }
      );
      if (!sel.ok) {
        return { statusCode: 500, body: JSON.stringify({ success: false, error: await sel.text() }) };
      }
      const ex = await sel.json();
      if (Array.isArray(ex) && ex.length > 0) existingId = ex[0].id;
    }

    let writeRes;
    if (existingId) {
      writeRes = await fetch(
        `${SUPABASE_URL}/rest/v1/streaming_connections?id=eq.${existingId}`,
        {
          method: 'PATCH',
          headers: { ...restHeaders, Prefer: 'return=representation' },
          body: JSON.stringify(payload)
        }
      );
    } else {
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
      return { statusCode: 500, body: JSON.stringify({ success: false, error: await writeRes.text() }) };
    }

    const data = await writeRes.json();
    const connection = data[0] || null;

    // ─────────────────────────────────────────────────────────────────────────────
    // 4) Tell ingest to point at THIS user's Kick channel (single call)
    //    server→server, optional ADMIN_SECRET, non-fatal if it hiccups
    // ─────────────────────────────────────────────────────────────────────────────
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
        if (process.env.ADMIN_SECRET) headers['x-admin-secret'] = process.env.ADMIN_SECRET;

        const res = await fetch(`${base}/.netlify/functions/set-ingest-source`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ userId }) // no handle hard-coding; function will look it up
        });

        const txt = await res.text();
        const json = (res.headers.get('content-type') || '').includes('application/json')
          ? JSON.parse(txt) : { raw: txt };

        if (res.ok) {
          ingest = json;
        } else {
          ingestError = json?.error || json?.message || txt || `HTTP ${res.status}`;
        }
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
        ingest: ingest || undefined,
        ingestError: ingestError || undefined
      })
    };
  } catch (err) {
    console.error('add-kick-channel error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
