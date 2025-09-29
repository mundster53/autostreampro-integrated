// netlify/functions/add-kick-channel.js
// Dependency-free version (uses Supabase REST, not @supabase/supabase-js)

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
          error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars'
        })
      };
    }

    const body = JSON.parse(event.body || '{}');
    const userId = String(body.userId || '').trim();
    const rawUsername = String(body.kickUsername || '').trim();

    if (!userId || !rawUsername) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'Missing userId or kickUsername' })
      };
    }

    // very light normalization: allow letters, numbers, underscore, dot, hyphen
    const username = rawUsername.toLowerCase().replace(/[^a-z0-9._-]/g, '');
    const platform = 'kick';

    const baseHeaders = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    };

    // 1) See if a Kick connection already exists for this user
    const selRes = await fetch(
      `${SUPABASE_URL}/rest/v1/streaming_connections?user_id=eq.${encodeURIComponent(
        userId
      )}&platform=eq.${platform}&select=id`,
      { headers: baseHeaders }
    );

    if (!selRes.ok) {
      const t = await selRes.text();
      return { statusCode: 500, body: JSON.stringify({ success: false, error: t }) };
    }

    const existing = await selRes.json();

    // Data to upsert
    const payload = {
      user_id: userId,
      platform,
      platform_user_id: username, // we store the username as the platform_user_id for Kick
      username: rawUsername,
      is_active: true,
      updated_at: new Date().toISOString()
    };

    let writeRes;

    if (Array.isArray(existing) && existing.length > 0) {
      // 2a) Update existing row
      const id = existing[0].id;
      writeRes = await fetch(
        `${SUPABASE_URL}/rest/v1/streaming_connections?id=eq.${id}`,
        {
          method: 'PATCH',
          headers: { ...baseHeaders, Prefer: 'return=representation' },
          body: JSON.stringify(payload)
        }
      );
    } else {
      // 2b) Insert new row
      writeRes = await fetch(`${SUPABASE_URL}/rest/v1/streaming_connections`, {
        method: 'POST',
        headers: { ...baseHeaders, Prefer: 'return=representation' },
        body: JSON.stringify(payload)
      });
    }

    if (!writeRes.ok) {
      const t = await writeRes.text();
      return { statusCode: 500, body: JSON.stringify({ success: false, error: t }) };
    }

    const data = await writeRes.json();
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, connection: data[0] || null })
    };
  } catch (err) {
    console.error('add-kick-channel error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
