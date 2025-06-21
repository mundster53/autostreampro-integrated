const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const supabaseUrl = 'https://ksgehuprwrqvmmdngjoj.supabase.co';
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzZ2VodXByd3Jxdm1tZG5nam9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQyMzQxMDYsImV4cCI6MjA0OTgxMDEwNn0.Qr8aaP2VfHYQDHo7FMp6KWs6Jd0-U3y6F4HzKpWqJeI';
  
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { platform, authData } = JSON.parse(event.body);
    
    const { data, error } = await supabase
      .from('platform_connections')
      .upsert({
        user_id: 'test-user',
        platform: platform,
        access_token: authData.accessToken,
        refresh_token: authData.refreshToken || null,
        expires_at: authData.expiresIn ? new Date(Date.now() + authData.expiresIn * 1000) : null,
        connected_at: new Date()
      });

    if (error) throw error;

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, data })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
