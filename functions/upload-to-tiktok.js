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
        const { clipId, userId, title, privacy } = JSON.parse(event.body);

        // Get clip details
        const { data: clip } = await supabase
            .from('clips')
            .select('*')
            .eq('id', clipId)
            .single();

        if (!clip) {
            throw new Error('Clip not found');
        }

        // Get TikTok connection
        const { data: connection } = await supabase
            .from('streaming_connections')
            .select('access_token, refresh_token')
            .eq('user_id', userId)
            .eq('platform', 'tiktok')
            .single();

        if (!connection) {
            throw new Error('TikTok not connected');
        }

        // Check creator info first (required by TikTok)
        const creatorInfoResponse = await fetch('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${connection.access_token}`,
                'Content-Type': 'application/json'
            }
        });

        const creatorInfo = await creatorInfoResponse.json();

        if (!creatorInfoResponse.ok) {
            throw new Error('Failed to get creator info');
        }

        // Resolve a canonical video URL (manual_clip_url > video_url > metadata)
        const sourceUrl =
        clip.manual_clip_url ||
        clip.video_url ||
        (clip?.metadata?.video_url) ||
        (clip?.metadata?.s3_key
            ? `https://autostreampro-clips.s3.us-east-2.amazonaws.com/${clip.metadata.s3_key}`
            : null);

        if (!sourceUrl) {
        throw new Error('No playable video URL resolved for this clip');
        }


        // Initialize TikTok upload
        const uploadResponse = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${connection.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                post_info: {
                    title: title || clip.viral_title || clip.title,
                    privacy_level: privacy || 'SELF_ONLY', // Default to private for safety
                    disable_duet: false,
                    disable_comment: false,
                    disable_stitch: false
                },
                source_info: {
                    source: 'PULL_FROM_URL',
                    video_url: sourceUrl
                }
            })
        });

        const uploadData = await uploadResponse.json();

        if (!uploadResponse.ok) {
            console.error('TikTok upload failed:', uploadData);
            throw new Error(uploadData.error?.message || 'Upload initialization failed');
        }

        // Update clip status
        await supabase
            .from('clips')
            .update({ 
                status: 'processing',
                tiktok_publish_id: uploadData.data.publish_id,
                updated_at: new Date().toISOString()
            })
            .eq('id', clipId);

        // Store publish ID for status checking
        await supabase
            .from('publishing_queue')
            .insert({
                clip_id: clipId,
                platform: 'tiktok',
                publish_id: uploadData.data.publish_id,
                status: 'processing',
                created_at: new Date().toISOString()
            });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                success: true,
                publishId: uploadData.data.publish_id,
                message: 'Video upload initiated. Processing may take a few minutes.'
            })
        };

    } catch (error) {
        console.error('TikTok upload error:', error);
        
        // Log error for debugging
        await supabase
            .from('analytics_events')
            .insert({
                event_type: 'tiktok_upload_error',
                event_data: { 
                    error: error.message,
                    clipId: JSON.parse(event.body).clipId 
                },
                created_at: new Date().toISOString()
            });

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to upload to TikTok',
                details: error.message 
            })
        };
    }
};