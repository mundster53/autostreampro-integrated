// netlify/functions/add-kick-channel.js
const { supabase } = require('./_supabase');

const json = (status, payload = {}) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    // CORS so it works from your site and local dev
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  },
  body: JSON.stringify(payload)
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200);
  if (event.httpMethod !== 'POST') return json(405, { success: false, error: 'Method not allowed' });

  try {
    const { userId, kickUsername } = JSON.parse(event.body || '{}');

    if (!userId || !kickUsername) {
      return json(400, { success: false, error: 'Missing userId or kickUsername' });
    }

    // Normalize Kick slug (strip leading @, trim)
    const slug = String(kickUsername).trim().replace(/^@/, '');
    const isValid = /^[A-Za-z0-9_]+$/.test(slug);
    if (!isValid) return json(400, { success: false, error: 'Invalid Kick username' });

    // Does a Kick connection already exist?
    const { data: existing, error: selectError } = await supabase
      .from('streaming_connections')
      .select('id')
      .eq('user_id', userId)
      .eq('platform', 'kick')
      .maybeSingle();

    if (selectError) {
      console.error('Select error:', selectError);
      return json(500, { success: false, error: 'Database read error' });
    }

    let writeError = null;

    if (existing) {
      // Update existing connection
      const { error } = await supabase
        .from('streaming_connections')
        .update({
          platform_user_id: slug,
          username: slug,
          is_active: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);
      writeError = error;
    } else {
      // Create new connection
      const { error } = await supabase
        .from('streaming_connections')
        .insert({
          user_id: userId,
          platform: 'kick',
          platform_user_id: slug,
          username: slug,
          is_active: true
        });
      writeError = error;
    }

    if (writeError) {
      console.error('Write error:', writeError);
      return json(500, { success: false, error: 'Database write error' });
    }

    // Optional: mirror the URL into user_profiles if that column exists
    try {
      await supabase
        .from('user_profiles')
        .update({ kick_channel_url: `https://kick.com/${slug}` })
        .eq('user_id', userId);
    } catch (e) {
      // Non-fatal if table/column not present
      console.warn('user_profiles update skipped:', e?.message);
    }

    return json(200, { success: true, username: slug });
  } catch (err) {
    console.error('Unhandled error:', err);
    return json(500, { success: false, error: err.message });
  }
};
