const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    // Only accept POST
    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const { code } = JSON.parse(event.body);
        
        if (!code) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'No authorization code provided' })
            };
        }

        // Exchange code for access token
        const tokenUrl = 'https://open.tiktokapis.com/v2/oauth/token/';
        
        const tokenResponse = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                client_key: process.env.TIKTOK_CLIENT_KEY,
                client_secret: process.env.TIKTOK_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code'
            })
        });

        const tokenData = await tokenResponse.json();
        
        if (!tokenResponse.ok || !tokenData.access_token) {
            console.error('TikTok token exchange failed:', tokenData);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Failed to exchange code for token',
                    details: tokenData.error || 'Unknown error'
                })
            };
        }

        // Get user info using the access token
        const userInfoUrl = 'https://open.tiktokapis.com/v2/user/info/';
        
        const userInfoResponse = await fetch(userInfoUrl + '?fields=open_id,display_name,avatar_url', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`
            }
        });

        const userInfo = await userInfoResponse.json();
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expires_in: tokenData.expires_in,
                user_id: userInfo.data?.user?.open_id || 'tiktok_user',
                username: userInfo.data?.user?.display_name || 'TikTok User',
                avatar_url: userInfo.data?.user?.avatar_url
            })
        };

    } catch (error) {
        console.error('TikTok auth error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Authentication failed',
                details: error.message 
            })
        };
    }
};