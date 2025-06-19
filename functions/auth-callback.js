exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { platform, code, redirectUri } = JSON.parse(event.body);

    try {
        let tokenResponse;
        
        switch(platform) {
            case 'twitch':
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
                break;
            
            case 'youtube':
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
                break;
                
            // Add other platforms...
        }
        
        const tokenData = await tokenResponse.json();
        
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                success: true, 
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token 
            })
        };
        
    } catch (error) {
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
};
