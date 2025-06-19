exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { platform, code, redirectUri } = JSON.parse(event.body);

    try {
        let tokenResponse;
        let tokenData;
        
        switch(platform) {
            case 'twitch':
                // Check if Twitch credentials are configured
                if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
                    return {
                        statusCode: 400,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            success: false, 
                            error: 'Twitch OAuth not configured. Please add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET environment variables.'
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
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        success: true, 
                        access_token: tokenData.access_token,
                        refresh_token: tokenData.refresh_token,
                        platform_user_id: twitchUser.data[0]?.id,
                        platform_username: twitchUser.data[0]?.login
                    })
                };
                
            case 'youtube':
                // Check if YouTube credentials are configured
                if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
                    return {
                        statusCode: 400,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            success: false, 
                            error: 'YouTube OAuth not configured. Please add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET environment variables.'
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
                
                // Get user info from YouTube
                const youtubeUserResponse = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&access_token=${tokenData.access_token}`);
                const youtubeUser = await youtubeUserResponse.json();
                
                return {
                    statusCode: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        success: true, 
                        access_token: tokenData.access_token,
                        refresh_token: tokenData.refresh_token,
                        platform_user_id: youtubeUser.items[0]?.id,
                        platform_username: youtubeUser.items[0]?.snippet?.title
                    })
                };
                
            case 'instagram':
                // Check if Instagram credentials are configured
                if (!process.env.INSTAGRAM_CLIENT_ID || !process.env.INSTAGRAM_CLIENT_SECRET) {
                    return {
                        statusCode: 400,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            success: false, 
                            error: 'Instagram OAuth not configured. Please add INSTAGRAM_CLIENT_ID and INSTAGRAM_CLIENT_SECRET environment variables.'
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
                
                // Get user info from Instagram
                const instagramUserResponse = await fetch(`https://graph.instagram.com/me?fields=id,username&access_token=${tokenData.access_token}`);
                const instagramUser = await instagramUserResponse.json();
                
                return {
                    statusCode: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        success: true, 
                        access_token: tokenData.access_token,
                        refresh_token: tokenData.refresh_token || null,
                        platform_user_id: instagramUser.id,
                        platform_username: instagramUser.username
                    })
                };
                
            case 'tiktok':
                // Check if TikTok credentials are configured (you don't have these yet)
                if (!process.env.TIKTOK_CLIENT_KEY || !process.env.TIKTOK_CLIENT_SECRET) {
                    return {
                        statusCode: 400,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            success: false, 
                            error: 'TikTok app is pending approval. OAuth will be available once TikTok approves your developer application. Please try again in a few days.'
                        })
                    };
                }
                
                // TikTok OAuth code (will run once you get approved and add credentials)
                tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Cache-Control': 'no-cache'
                    },
                    body: new URLSearchParams({
                        client_key: process.env.TIKTOK_CLIENT_KEY,
                        client_secret: process.env.TIKTOK_CLIENT_SECRET,
                        code,
                        grant_type: 'authorization_code',
                        redirect_uri: redirectUri
                    })
                });
                tokenData = await tokenResponse.json();
                
                // Get user info from TikTok
                const tiktokUserResponse = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name', {
                    headers: {
                        'Authorization': `Bearer ${tokenData.access_token}`
                    }
                });
                const tiktokUser = await tiktokUserResponse.json();
                
                return {
                    statusCode: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        success: true, 
                        access_token: tokenData.access_token,
                        refresh_token: tokenData.refresh_token,
                        platform_user_id: tiktokUser.data?.user?.open_id,
                        platform_username: tiktokUser.data?.user?.display_name
                    })
                };
                
            default:
                return {
                    statusCode: 400,
                    headers: { 'Content-Type': 'application/json' },
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                success: false, 
                error: error.message || `OAuth exchange failed for ${platform}`
            })
        };
    }
};
