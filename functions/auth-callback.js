exports.handler = async (event, context) => {
    // Set CORS headers
    const headers = {
        'Access-Control-Allow-Origin': 'https://www.autostreampro.com',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers,
            body: JSON.stringify({ success: false, error: 'Method Not Allowed' })
        };
    }

    const { platform, code, redirectUri } = JSON.parse(event.body);

    try {
        let tokenResponse;
        let tokenData;
        
        switch(platform) {
            case 'twitch':
                if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({ 
                            success: false, 
                            error: 'Twitch OAuth not configured. Please add credentials to environment variables.'
                        })
                    };
                }
                
                tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        client_id: process.env.TWITCH_CLIENT_ID,
                        client_secret: process.env.TWITCH_CLIENT_SECRET,
                        code,
                        grant_type: 'authorization_code',
                        redirect_uri: redirectUri
                    })
                });
                tokenData = await tokenResponse.json();
                
                if (!tokenResponse.ok) {
                    throw new Error(`Twitch OAuth failed: ${tokenData.message}`);
                }
                
                // Get user info from Twitch
                const twitchUserResponse = await fetch('https://api.twitch.tv/helix/users', {
                    headers: {
                        'Authorization': `Bearer ${tokenData.access_token}`,
                        'Client-Id': process.env.TWITCH_CLIENT_ID
                    }
                });
                const twitchUser = await twitchUserResponse.json();
                
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ 
                        success: true, 
                        access_token: tokenData.access_token,
                        refresh_token: tokenData.refresh_token,
                        platform_user_id: twitchUser.data[0]?.id,
                        platform_username: twitchUser.data[0]?.login
                    })
                };
                
            case 'youtube':
                if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({ 
                            success: false, 
                            error: 'YouTube OAuth not configured. Please add credentials to environment variables.'
                        })
                    };
                }
                
                tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        client_id: process.env.YOUTUBE_CLIENT_ID,
                        client_secret: process.env.YOUTUBE_CLIENT_SECRET,
                        code,
                        grant_type: 'authorization_code',
                        redirect_uri: redirectUri
                    })
                });
                tokenData = await tokenResponse.json();
                
                if (!tokenResponse.ok) {
                    throw new Error(`YouTube OAuth failed: ${tokenData.error_description}`);
                }
                
                // Get user info from YouTube
                const youtubeUserResponse = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&access_token=${tokenData.access_token}`);
                const youtubeUser = await youtubeUserResponse.json();
                
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ 
                        success: true, 
                        access_token: tokenData.access_token,
                        refresh_token: tokenData.refresh_token,
                        platform_user_id: youtubeUser.items[0]?.id,
                        platform_username: youtubeUser.items[0]?.snippet?.title
                    })
                };
                
            case 'instagram':
                if (!process.env.INSTAGRAM_CLIENT_ID || !process.env.INSTAGRAM_CLIENT_SECRET) {
                    return {
                        statusCode: 400,
                        headers,
                        body: JSON.stringify({ 
                            success: false, 
                            error: 'Instagram OAuth not configured. Please add credentials to environment variables.'
                        })
                    };
                }
                
                tokenResponse = await fetch('https://api.instagram.com/oauth/access_token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        client_id: process.env.INSTAGRAM_CLIENT_ID,
                        client_secret: process.env.INSTAGRAM_CLIENT_SECRET,
                        code,
                        grant_type: 'authorization_code',
                        redirect_uri: redirectUri
                    })
                });
                tokenData = await tokenResponse.json();
                
                if (!tokenResponse.ok) {
                    throw new Error(`Instagram OAuth failed: ${tokenData.error_message}`);
                }
                
                return {
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ 
                        success: true, 
                        access_token: tokenData.access_token,
                        platform_user_id: tokenData.user_id,
                        platform_username: tokenData.user_id // Instagram Basic Display doesn't provide username
                    })
                };
                
            default:
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ 
                        success: false, 
                        error: `Unsupported platform: ${platform}` 
                    })
                };
        }
        
    } catch (error) {
        console.error(`OAuth error for ${platform}:`, error);
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
                success: false, 
                error: error.message || `OAuth exchange failed for ${platform}`
            })
        };
    }
};
