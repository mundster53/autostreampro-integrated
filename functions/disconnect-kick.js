// FILE: netlify/functions/disconnect-kick.js
// CommonJS + require() version

const { createClient } = require('@supabase/supabase-js');

const json = (statusCode, obj) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE) {
    return json(500, { error: 'Missing SUPABASE_URL or service key env var' });
  }

  try {
    const { userId } = JSON.parse(event.body || '{}');
    if (!userId) return json(400, { error: 'userId is required' });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE, { auth: { persistSession: false } });

    // Deactivate Kick connection
    const { error: connErr } = await supabase
      .from('streaming_connections')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('platform', 'kick');
    if (connErr) return json(500, { error: `DB error (streaming_connections): ${connErr.message}` });

    // Clear profile fields (best-effort)
    const { error: profileErr } = await supabase
      .from('user_profiles')
      .update({ kick_channel_slug: null, kick_channel_url: null, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (profileErr) console.warn('user_profiles update error:', profileErr.message);

    return json(200, { success: true });
  } catch (err) {
    console.error('disconnect-kick error:', err);
    return json(500, { error: 'Internal server error' });
  }
};
