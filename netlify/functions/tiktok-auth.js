const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event, context) => {
    // Enable CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    try {
        // Get parameters
        const code = event.queryStringParameters?.code;
        const type = event.queryStringParameters?.type;
        
        // If no code, this is the initial request - redirect to TikTok
        if (!code) {
            // For demo/testing - just redirect back as if connected
            return {
                statusCode: 302,
                headers: {
                    Location: '/onboarding.html?tiktok=connected&message=TikTok+Connected+Successfully'
                }
            };
        }
        
        // If we have a code, handle the OAuth callback
        // (Add your OAuth token exchange code here later)
        
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
