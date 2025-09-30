// netlify/functions/add-kick-channel.js
// Dynamically inspects the `streaming_connections` columns via Supabase GraphQL
// and only writes to columns that actually exist.
// AFTER a successful write, it calls set-ingest-source with { userId } to point ingest at this user's Kick channel.

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
      // If we cannot introspect, fail loudly so we don’t guess wrong
      return {
        statusCode: 500,
        body: JSON.stringify({ success: false, error: 'Could not introspect streaming_connections schema' })
      };
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 2) Build a payload that ONLY includes columns that exist
    // ─────────────────────────────────────────────────────────────────────────────
    const payload = {};

    // Always try to set these common columns if present:
    if (columns.has('user_id')) payload.user_id = userId;
    if (columns.has('platform')) payload.platform = platform;
    if (columns.has('platform_user_id')) payload.platform_user_id = normalizedUsername;
    if (columns.has('is_active')) payload.is_active = true;
    if (columns.has('updated_at')) payload.updated_at = new Date().toISOString();

    // Store the human username in the *best matching* column that exists
    const usernameCandidateColumns = [
      'username',
      'platform_username',
      'display_name',
      'channel_username',
      'channel_title',
      'name'
    ];
    const nameCol = usernameCandidateColumns.find(c => columns.has(c));
    if (nameCol) payload[nameCol] = rawUsername; // keep original case for display

    // ─────────────────────────────────────────────────────────────────────────────
    // 3) Upsert-style: if row for (user_id, platform) exists -> update; else insert
    // ─────────────────────────────────────────────────────────────────────────────
    const restHeaders = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    };

    // Try to find existing connection
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
      // Ensure minimally required fields for insert
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
    // 4) NEW: Point ingest at this user's Kick channel (Option A: send userId)
    //     We call our sibling Netlify function *server-side* to avoid any
    //     client hardcoding. We do NOT fail the whole request if ingest step fails.
    // ─────────────────────────────────────────────────────────────────────────────
    let ingest = null;
    let ingestError = null;
    try {
      const base =
        process.env.URL || // production primary URL (custom domain if set)
        process.env.DEPLOY_PRIME_URL || // deploy-specific URL
        ''; // if empty, skip calling

      if (base) {
        const res = await fetch(`${base}/.netlify/functions/set-ingest-source`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId })
        });
        const txt = await res.text();
        ingest = (res.headers.get('content-type') || '').includes('application/json')
          ? JSON.parse(txt)
          : { raw: txt };
        if (!res.ok) {
          ingestError = ingest?.message || ingest?.error || txt || `HTTP ${res.status}`;
          ingest = null;
        }
      } else {
        ingestError = 'No base URL available to call set-ingest-source';
      }
    } catch (e) {
      ingestError = e?.message || String(e);
    }

    // Final response: always return the DB result; include ingest status if available
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
