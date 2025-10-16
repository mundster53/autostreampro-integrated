// SAVE CONNECTION API - PRODUCTION READY
// Status: ACTIVE
// Purpose: Save platform connections to database

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    // Handle CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            }
        };
    }

    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );

    try {
        // Get auth header
        const token = event.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return {
                statusCode: 401,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'No authorization token' })
            };
        }

        // Get user from token
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
            return {
                statusCode: 401,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'Invalid token' })
            };
        }

console.log('Token:', token);
console.log('User email:', user.email);
console.log('User ID:', user.id);

        const { platform, platformUserId, accessToken, refreshToken, username } = JSON.parse(event.body);

        console.log(`Saving ${platform} connection for user ${user.id}`);

        // Save to streaming_connections table (NEW TABLE)
        const { data, error } = await supabase
            .from('streaming_connections')
            // Save to streaming_connections table (match actual columns)
const row = {
  user_id: user.id,
  platform: String(platform || '').toLowerCase(),
  platform_user_id: platformUserId || null,
  platform_username: username || platform || null,
  refresh_token: refreshToken || null,
  channel_id: (String(platform).toLowerCase() === 'youtube' ? (platformUserId || null) : null),
  is_active: true,
  updated_at: new Date().toISOString(),
};

const upsertRes = await supabase
  .from('streaming_connections')
  .upsert(row, { onConflict: 'user_id,platform' })
  .select();

if (upsertRes.error) throw upsertRes.error;


        if (error) throw error;

        console.log(`Successfully saved ${platform} connection`);

        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ success: true, connection: data })
        };

    } catch (error) {
        console.error('Save connection error:', error);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: error.message })
        };
    }
};