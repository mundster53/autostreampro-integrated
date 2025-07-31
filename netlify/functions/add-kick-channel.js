const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }

  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, kickUsername } = JSON.parse(event.body);

    if (!userId || !kickUsername) {
      throw new Error('Missing userId or kickUsername');
    }

    console.log(`Adding Kick channel ${kickUsername} for user ${userId}`);

    // Skip Kick API verification due to Cloudflare protection
    console.log('Skipping Kick API verification due to Cloudflare protection');

    // Check if connection already exists - WITH BETTER ERROR HANDLING
    let existing = null;
    try {
      const { data, error } = await supabase
        .from('streaming_connections')
        .select('id')
        .eq('user_id', userId)
        .eq('platform', 'kick');
      
      if (error) {
        console.error('Error checking existing connection:', error);
        // Continue anyway - we'll try to insert
      } else {
        existing = data && data.length > 0 ? data[0] : null;
      }
    } catch (err) {
      console.error('Query error:', err);
      // Continue with insert attempt
    }

    const connectionData = {
      user_id: userId,
      platform: 'kick',
      platform_user_id: `kick_${kickUsername}`,
      platform_username: kickUsername,
      access_token: 'PUBLIC_ACCESS',
      refresh_token: 'NOT_APPLICABLE',
      is_active: true,
      created_at: new Date().toISOString()  // FIXED: was connected_at
    };

    // Insert or update with better error handling
    try {
      if (existing) {
        const { error } = await supabase
          .from('streaming_connections')
          .update(connectionData)
          .eq('id', existing.id);
        
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('streaming_connections')
          .insert([connectionData])  // Note: wrap in array
          .select();
        
        if (error) throw error;
        console.log('Inserted connection:', data);
      }
    } catch (error) {
      console.error('Save error:', error);
      throw error;
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        username: kickUsername
      })
    };

  } catch (error) {
    console.error('Kick connection error:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
