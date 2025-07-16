exports.handler = async (event, context) => {
 // Enable CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    // NEW: Add type checking
    const { type, state } = event.queryStringParameters || {};
    
    // NEW: If no code, redirect to TikTok OAuth
    if (!code) {
        const IS_SANDBOX = true;
        const authDomain = IS_SANDBOX ? 'https://sandbox-auth.tiktok.com' : 'https://www.tiktok.com';
        const redirectUri = 'https://autostreampro.com/.netlify/functions/tiktok-auth';
        const clientKey = process.env.TIKTOK_CLIENT_KEY;
        
        if (type === 'login') {
            // Login Kit flow
            const scope = 'user.info.basic,user.info.profile';
            const authUrl = `${authDomain}/v2/auth/authorize?client_key=${clientKey}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=tiktok-login`;
            
            return {
                statusCode: 302,
                headers: { Location: authUrl, ...headers }
            };
        } else {
            // Content Posting flow
            const scope = 'video.upload,video.publish';
            const authUrl = `${authDomain}/v2/auth/authorize?client_key=${clientKey}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=tiktok-content`;
            
            return {
                statusCode: 302,
                headers: { Location: authUrl, ...headers }
            };
        }
    }

  const { code } = event.queryStringParameters;
  
  if (!code) {
    // Start OAuth flow
    const authUrl = `https://www.tiktok.com/auth/authorize/?client_key=${process.env.TIKTOK_CLIENT_KEY}&scope=user.info.basic,video.upload&response_type=code&redirect_uri=${encodeURIComponent('https://autostreampro-dashboard.netlify.app/tiktok-callback')}&state=random_state`;
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ authUrl })
    };
  }

  try {
    // Exchange code for access token
    const response = await fetch('https://open-api.tiktok.com/oauth/access_token/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: 'https://autostreampro-dashboard.netlify.app/tiktok-callback'
      })
    });

    const data = await response.json();

    if (data.data && data.data.access_token) {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          success: true,
          access_token: data.data.access_token,
          open_id: data.data.open_id
        })
      };
    } else {
      throw new Error('Failed to get access token');
    }
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
