console.log("🎯 HIT youtube-auth.js");


exports.handler = async (event, context) => {
  // Handle CORS
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

  // GET request - Test YouTube API connection (like Twitter)
  if (event.httpMethod === 'GET') {
    try {
      // Test if YouTube API key works by getting channel info
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&key=${process.env.YOUTUBE_API_KEY}`,
        {
          headers: {
            'Authorization': `Bearer ${process.env.YOUTUBE_ACCESS_TOKEN || 'test'}`
          }
        }
      );

      if (response.status === 401) {
        // API key works but no access token - this is expected
        return {
          statusCode: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            success: false,
            error: 'YouTube API configured but no access token. Please connect via OAuth.',
            needsOAuth: true
          })
        };
      }

      const data = await response.json();

      if (response.ok && data.items && data.items.length > 0) {
        const channel = data.items[0];
        return {
          statusCode: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            success: true,
            channel: {
              id: channel.id,
              title: channel.snippet.title,
              description: channel.snippet.description
            }
          })
        };
      } else {
        return {
          statusCode: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            success: false,
            error: 'YouTube API key works but no channel access. OAuth required.',
            needsOAuth: true
          })
        };
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
  }

  // POST request - Handle OAuth code exchange
  if (event.httpMethod === 'POST') {
    try {
      const { code } = JSON.parse(event.body);

      if (!code) {
        return {
          statusCode: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ success: false, error: 'Authorization code required' })
        };
      }

      // Exchange code for tokens
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          code: code,
          grant_type: 'authorization_code',
          redirect_uri: 'https://autostreampro.com/auth/youtube.html'
        })
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        console.error('YouTube token exchange failed:', tokenData);
        return {
          statusCode: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ 
            success: false, 
            error: tokenData.error_description || 'Token exchange failed' 
          })
        };
      }

      // Get channel info with the new access token
      let channelInfo = {};
      if (tokenData.access_token) {
        try {
          const channelResponse = await fetch(
            `https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&key=${process.env.YOUTUBE_API_KEY}`,
            {
              headers: {
                'Authorization': `Bearer ${tokenData.access_token}`
              }
            }
          );

          if (channelResponse.ok) {
            const channelData = await channelResponse.json();
            if (channelData.items && channelData.items.length > 0) {
              const channel = channelData.items[0];
              channelInfo = {
                channel_id: channel.id,
                channel_title: channel.snippet.title,
                channel_description: channel.snippet.description
              };
            }
          }
        } catch (error) {
          console.error('Failed to get YouTube channel info:', error);
          // Continue without channel info - not critical
        }
      }

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          success: true,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_in: tokenData.expires_in,
          token_type: tokenData.token_type,
          scope: tokenData.scope,
          channel_id: channelInfo.channel_id,
          channel_title: channelInfo.channel_title
        })
      };

    } catch (error) {
      console.error('YouTube auth function error:', error);
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
  }

  return {
    statusCode: 405,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ success: false, error: 'Method Not Allowed' })
  };
};
