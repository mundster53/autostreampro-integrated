const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// TikTok posting - currently in demo mode
// TODO: Enable real TikTok API when ready
exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const { clipId, userId } = JSON.parse(event.body);

        // DEMO MODE - Remove this section when TikTok is ready
        // For now, just simulate posting
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        await supabase
            .from('clips')
            .update({ 
                status: 'published_demo',
                published_at: new Date().toISOString()
            })
            .eq('id', clipId);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                success: true,
                message: 'Posted to TikTok (Demo Mode)',
                demoMode: true
            })
        };

        // REAL TIKTOK CODE - Uncomment when ready
        /*
        // Get clip details
        const { data: clip } = await supabase
            .from('clips')
            .select('*')
            .eq('id', clipId)
            .single();

        // Get TikTok connection
        const { data: connection } = await supabase
            .from('platform_connections')
            .select('*')
            .eq('user_id', userId)
            .eq('platform', 'tiktok')
            .single();

        if (!connection) {
            throw new Error('TikTok not connected');
        }

        // TikTok API implementation here
        // ... rest of the real code ...
        */

    } catch (error) {
        console.error('TikTok posting error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to post to TikTok',
                details: error.message 
            })
        };
    }
};