const { createClient } = require('@supabase/supabase-js');
con// SIMPLIFIED VERSION FOR DEMO
exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    try {
        const { clipId } = JSON.parse(event.body);

        // Simulate posting delay
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Log activity for demo
        await supabase
            .from('clip_activities')
            .insert({
                clip_id: clipId,
                action: 'Posted to TikTok (Demo Mode)',
                score: Math.floor(Math.random() * 40) + 60 // Random 60-100
            });

        // Update clip status
        await supabase
            .from('clips')
            .update({ 
                status: 'published',
                published_at: new Date().toISOString()
            })
            .eq('id', clipId);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                success: true,
                message: 'Posted to TikTok successfully (Demo)',
                demoMode: true,
                tiktokUrl: 'https://www.tiktok.com/@yourusername/video/1234567890'
            })
        };
    } catch (error) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to post' })
        };
    }
};st axios = require('axios');

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
        const { clipId, userId } = JSON.parse(event.body);

        // Get clip details
        const { data: clip, error: clipError } = await supabase
            .from('clips')
            .select('*')
            .eq('id', clipId)
            .single();

        if (clipError || !clip) {
            throw new Error('Clip not found');
        }

        // Get user's TikTok access token
        const { data: connection, error: connError } = await supabase
            .from('platform_connections')
            .select('*')
            .eq('user_id', userId)
            .eq('platform', 'tiktok')
            .single();

        if (connError || !connection) {
            throw new Error('TikTok not connected');
        }

        // TIKTOK API - Video Upload Process
        // Step 1: Initialize video upload
        const initResponse = await axios.post(
            'https://sandbox.tiktokapis.com/v2/post/publish/video/init/',
            {
                post_info: {
                    title: clip.title || 'Check out this gaming moment!',
                    privacy_level: 'PUBLIC_TO_EVERYONE',
                    disable_duet: false,
                    disable_comment: false,
                    disable_stitch: false,
                    video_cover_timestamp_ms: 1000
                },
                source_info: {
                    source: 'FILE_UPLOAD',
                    video_size: clip.file_size || 10000000, // File size in bytes
                    chunk_size: 10000000,
                    total_chunk_count: 1
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${connection.access_token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const { publish_id, upload_url } = initResponse.data.data;

        // Step 2: Upload video file
        // For demo purposes, you might want to use a test video URL
        const videoData = await axios.get(clip.video_url, { 
            responseType: 'arraybuffer' 
        });

        await axios.put(
            upload_url,
            videoData.data,
            {
                headers: {
                    'Content-Type': 'video/mp4',
                    'Content-Length': videoData.data.length
                }
            }
        );

        // Step 3: Finalize the upload
        const publishResponse = await axios.post(
            'https://sandbox.tiktokapis.com/v2/post/publish/status/fetch/',
            {
                publish_id: publish_id
            },
            {
                headers: {
                    'Authorization': `Bearer ${connection.access_token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // Update clip status
        await supabase
            .from('clips')
            .update({ 
                status: 'published',
                published_at: new Date().toISOString(),
                platform_post_id: publish_id
            })
            .eq('id', clipId);

        // Log activity
        await supabase
            .from('clip_activities')
            .insert({
                clip_id: clipId,
                action: 'Published to TikTok',
                score: clip.ai_score ? Math.round(clip.ai_score * 100) : null
            });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                success: true,
                message: 'Posted to TikTok successfully',
                publishId: publish_id,
                status: publishResponse.data
            })
        };

    } catch (error) {
        console.error('TikTok posting error:', error);
        
        // Log failed activity
        if (clipId) {
            await supabase
                .from('clip_activities')
                .insert({
                    clip_id: clipId,
                    action: 'Failed to post to TikTok: ' + error.message,
                    score: null
                });
        }

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
