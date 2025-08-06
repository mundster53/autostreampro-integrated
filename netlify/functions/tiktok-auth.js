const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    try {
        const code = event.queryStringParameters?.code;
        
        // If no code, redirect to TikTok OAuth
        if (!code) {
            const params = new URLSearchParams({
                client_key: process.env.TIKTOK_CLIENT_KEY,
                scope: 'user.info.basic,video.publish',
                response_type: 'code',
                redirect_uri: 'https://autostreampro.com/onboarding.html',
                state: 'tiktok'
            });
            
            // FOR SANDBOX TESTING - Add this line
            if (process.env.TIKTOK_SANDBOX === 'true') {
                params.append('sandbox', 'true');
            }
            
            const authUrl = `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
            
            return {
                statusCode: 302,
                headers: {
                    Location: authUrl
                }
            };
        }
        
        // If we have a code, handle the callback
        // For now, just redirect back as connected
        return {
            statusCode: 302,
            headers: {
                Location: '/onboarding.html?tiktok=connected'
            }
        };
        
    } catch (error) {
        console.error('TikTok auth error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Authentication failed' })
        };
    }
};