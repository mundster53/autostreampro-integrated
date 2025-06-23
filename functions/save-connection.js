const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST'
      }
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const { platform, authData } = JSON.parse(event.body);
    
    console.log('Saving platform connection:', { platform, authData });

    // Only save to dashboard database (the one that works)
    const supabase = createClient(
      'https://dykxhmdozgccawkbxejd.supabase.co',
      process.env.SUPABASE_DASHBOARD_KEY
    );

    const connectionData = {
      user_id: '99f0c4bb-9016-409e-83ef-2c827698a2d5',
      platform_name: platform,
      status: 'connected',
      access_token: authData.accessToken || authData.access_token || null,
      refresh_token: authData.refreshToken || authData.refresh_token || null,
      platform_user_id: authData.userID || authData.user_id || null,
      platform_username: authData.username || null,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('Connection data to save:', connectionData);

    const { data, error } = await supabase
      .from('platform_connections')
      .upsert(connectionData);

    if (error) {
      console.error('Database error:', error);
      throw error;
    }

    console.log('Saved successfully:', data);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        data: data
      })
    };

  } catch (error) {
    console.error('Function error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
