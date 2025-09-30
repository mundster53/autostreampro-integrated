// TEST FUNCTION - For testing dual platform publishing
// Save this as: functions/test-dual-publish.js

const { createClient } = require('@supabase/supabase-js');
const YouTubePublisher = require('../src/services/youtube-publisher');
const TikTokPublisher = require('../src/services/tiktok-publisher');

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
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const { clipId, platform } = JSON.parse(event.body);
        
        if (!clipId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'clipId is required' })
            };
        }

        console.log(`🧪 [TEST] Testing ${platform || 'both'} platform(s) for clip ${clipId}`);

        // Get clip details
        const { data: clip, error: clipError } = await supabase
            .from('clips')
            .select('*')
            .eq('id', clipId)
            .single();

        if (clipError || !clip) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Clip not found' })
            };
        }

        const results = {
            clipId,
            clipTitle: clip.title,
            aiScore: clip.ai_score,
            platforms: {}
        };

        // Test YouTube if requested or no platform specified
        if (!platform || platform === 'youtube' || platform === 'both') {
            console.log('📺 [TEST] Testing YouTube upload...');
            
            // Check if user has YouTube connected
            const { data: ytConnection } = await supabase
                .from('streaming_connections')
                .select('*')
                .eq('user_id', clip.user_id)
                .eq('platform', 'youtube')
                .eq('is_active', true)
                .single();

            if (ytConnection) {
                // Create test queue entry
                await supabase
                    .from('publishing_queue')
                    .insert({
                        clip_id: clipId,
                        platform: 'youtube',
                        status: 'pending',
                        attempts: 0,
                        created_at: new Date().toISOString(),
                        user_id: clip.user_id
                    });

                const youtubePublisher = new YouTubePublisher(supabase);
                const ytSuccess = await youtubePublisher.publishClip(clipId);
                
                results.platforms.youtube = {
                    connected: true,
                    success: ytSuccess,
                    message: ytSuccess ? 'Upload successful' : 'Upload failed - check logs'
                };
            } else {
                results.platforms.youtube = {
                    connected: false,
                    message: 'YouTube not connected for this user'
                };
            }
        }

        // Test TikTok if requested or no platform specified  
        if (!platform || platform === 'tiktok' || platform === 'both') {
            console.log('🎵 [TEST] Testing TikTok upload...');
            
            // Check if user has TikTok connected
            const { data: ttConnection } = await supabase
                .from('streaming_connections')
                .select('*')
                .eq('user_id', clip.user_id)
                .eq('platform', 'tiktok')
                .eq('is_active', true)
                .single();

            if (ttConnection) {
                // Create test queue entry
                await supabase
                    .from('publishing_queue')
                    .insert({
                        clip_id: clipId,
                        platform: 'tiktok',
                        status: 'pending',
                        attempts: 0,
                        created_at: new Date().toISOString(),
                        user_id: clip.user_id
                    });

                const tiktokPublisher = new TikTokPublisher(supabase);
                const ttSuccess = await tiktokPublisher.publishClip(clipId);
                
                results.platforms.tiktok = {
                    connected: true,
                    success: ttSuccess,
                    message: ttSuccess ? 'Upload initiated - check status' : 'Upload failed - check logs'
                };
            } else {
                results.platforms.tiktok = {
                    connected: false,
                    message: 'TikTok not connected for this user'
                };
            }
        }

        console.log('✅ [TEST] Test complete:', results);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                results
            })
        };

    } catch (error) {
        console.error('❌ [TEST] Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: error.message,
                stack: error.stack 
            })
        };
    }
};