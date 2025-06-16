exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST'
      }
    };
  }

  const { code } = event.queryStringParameters;
  
  if (!code) {
    // Start OAuth flow
    const authUrl = `https://api.instagram.com/oauth/authorize?client_id=${process.env.INSTAGRAM_CLIENT_ID}&redirect_uri=${encodeURIComponent('https://autostreampro-dashboard.netlify.app/instagram-callback')}&scope=user_profile,user_media&response_type=code`;
    
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
    const formData = new URLSearchParams();
    formData.append('client_id', process.env.INSTAGRAM_CLIENT_ID);
    formData.append('client_secret', process.env.INSTAGRAM_CLIENT_SECRET);
    formData.append('grant_type', 'authorization_code');
    formData.append('redirect_uri', 'https://autostreampro-dashboard.netlify.app/instagram-callback');
    formData.append('code', code);

    const response = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.access_token) {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          success: true,
          access_token: data.access_token,
          user_id: data.user_id
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