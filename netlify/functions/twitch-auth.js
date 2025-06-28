const fetch = require('node-fetch');

exports.handler = async (event) => {
    // Handle CORS
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
        const { code } = JSON.parse(event.body);
        
        // Exchange code for tokens
        const response = await fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.TWITCH_CLIENT_ID,
                client_secret: process.env.TWITCH_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: 'https://autostreampro.com/onboarding.html'
            })
        });

        const tokens = await response.json();
        
        if (tokens.access_token) {
            // Get user info
            const userResponse = await fetch('https://api.twitch.tv/helix/users', {
                headers: {
                    'Authorization': `Bearer ${tokens.access_token}`,
                    'Client-Id': process.env.TWITCH_CLIENT_ID
                }
            });
            
            const userData = await userResponse.json();
            const user = userData.data[0];
            
            return {
                statusCode: 200,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    user_id: user.id,
                    login: user.login,
                    display_name: user.display_name
                })
            };
        } else {
            throw new Error('No access token received');
        }
        
    } catch (error) {
        console.error('Twitch auth error:', error);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: error.message })
        };
    }
};