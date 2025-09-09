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

    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const { publishId, userId } = JSON.parse(event.body);

        // Get TikTok connection
        const { data: connection } = await supabase
            .from('streaming_connections')
            .select('access_token')
            .eq('user_id', userId)
            .eq('platform', 'tiktok')
            .single();

        if (!connection) {
            throw new Error('TikTok not connected');
        }

        // Check status with TikTok API
        const statusResponse = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${connection.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                publish_id: publishId
            })
        });

        const statusData = await statusResponse.json();

        if (!statusResponse.ok) {
            throw new Error(statusData.error?.message || 'Failed to get status');
        }

        const status = statusData.data.status;
        
        // Update database based on status
        if (status === 'PUBLISHED') {
            await supabase
                .from('clips')
                .update({ 
                    status: 'published',
                    published_at: new Date().toISOString(),
                    posted_platforms: supabase.raw("array_append(posted_platforms, 'tiktok')")
                })
                .eq('tiktok_publish_id', publishId);

            await supabase
                .from('publishing_queue')
                .update({ 
                    status: 'completed',
                    completed_at: new Date().toISOString()
                })
                .eq('publish_id', publishId);
        } else if (status === 'FAILED') {
            await supabase
                .from('clips')
                .update({ 
                    status: 'failed',
                    error_message: statusData.data.fail_reason
                })
                .eq('tiktok_publish_id', publishId);

            await supabase
                .from('publishing_queue')
                .update({ 
                    status: 'failed',
                    error: statusData.data.fail_reason
                })
                .eq('publish_id', publishId);
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                success: true,
                status: status,
                publiclyAccessible: statusData.data.publicly_accessible_post_id,
                failReason: statusData.data.fail_reason
            })
        };

    } catch (error) {
        console.error('TikTok status check error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to check status',
                details: error.message 
            })
        };
    }
};