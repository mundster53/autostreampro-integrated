const { createClient } = require('@supabase/supabase-js')

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
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { platform, authData } = JSON.parse(event.body);
    
    // Initialize both Supabase clients
    const onboardingSupabase = createClient(
      'https://ksgehuprwrqvmmdngjoj.supabase.co',
      process.env.SUPABASE_ONBOARDING_KEY
    );
    
    const dashboardSupabase = createClient(
      'https://dykxhmdozgccawkbxejd.supabase.co', 
      process.env.SUPABASE_DASHBOARD_KEY
    );

    const connectionData = {
      user_id: 'test-user',
      platform: platform,
      connected: true,
      auth_data: authData,
      created_at: new Date().toISOString()
    };

    // Save to both databases
    const [onboardingResult, dashboardResult] = await Promise.all([
      onboardingSupabase.from('platform_connections').upsert(connectionData),
      dashboardSupabase.from('platform_connections').upsert(connectionData)
    ]);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        onboarding: onboardingResult,
        dashboard: dashboardResult
      })
    };

  } catch (error) {
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
