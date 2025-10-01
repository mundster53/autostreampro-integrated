// DUAL PLATFORM QUEUE PROCESSOR - Handles YouTube and TikTok
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event, context) => {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
            }
        };
    }

    try {
        console.log('🚀 [DualQueue] Starting dual platform queue processing...');
        

        
        // Track results
        const results = {
            youtube: { attempted: 0, successful: 0, failed: 0 },
            tiktok: { attempted: 0, successful: 0, failed: 0 }
        };

        // PROCESS YOUTUBE QUEUE
        console.log('📺 [DualQueue] Processing YouTube queue...');
        
        const { data: youtubeQueue, error: ytError } = await supabase
            .from('publishing_queue')
            .select(`
                *,
                clips!inner (
                    id,
                    ai_score,
                    title,
                    game,
                    video_url,
                    user_id,
                    ai_analysis,
                    viral_title,
                    viral_description,
                    viral_tags,
                    tags,
                    youtube_url
                )
            `)
            .eq('platform', 'youtube')
            .eq('status', 'pending')
            .is('clips.youtube_url', null)  // Not already published
            .gte('clips.ai_score', 0.40)
            .order('clips.ai_score', { ascending: false })
            .limit(10);  // Process up to 10 YouTube videos per run

        if (!ytError && youtubeQueue?.length > 0) {
            console.log(`[DualQueue] Found ${youtubeQueue.length} YouTube clips to process`);
            
            for (const item of youtubeQueue) {
                results.youtube.attempted++;
                
                // Check user's daily limit
                const limitCheck = await checkUserDailyLimit(item.clips.user_id, 'youtube');
                if (!limitCheck.canUpload) {
                    console.log(`[DualQueue] User ${item.clips.user_id} reached YouTube daily limit`);
                    
                    // Mark as deferred
                    await supabase
                        .from('publishing_queue')
                        .update({
                            status: 'deferred',
                            last_error: `Daily limit reached (${limitCheck.count}/${limitCheck.limit})`,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', item.id);
                    
                    continue;
                }
                
                // Attempt to publish
                console.log(`[DualQueue] Publishing to YouTube: ${item.clips.title}`);
                // NEW:
                const uploadResult = await fetch('https://autostreampro.com/.netlify/functions/upload-to-youtube', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clipId: item.clip_id })
});
                const success = uploadResult.ok;
                
                if (success) {
                    results.youtube.successful++;
                    console.log(`✅ [DualQueue] YouTube upload successful for clip ${item.clip_id}`);
                } else {
                    results.youtube.failed++;
                    console.log(`❌ [DualQueue] YouTube upload failed for clip ${item.clip_id}`);
                }
                
                // Small delay between uploads
                await delay(2000);
            }
        }

        // PROCESS TIKTOK QUEUE
        console.log('🎵 [DualQueue] Processing TikTok queue...');
        
        const { data: tiktokQueue, error: ttError } = await supabase
            .from('publishing_queue')
            .select(`
                *,
                clips!inner (
                    id,
                    ai_score,
                    title,
                    game,
                    video_url,
                    user_id,
                    ai_analysis,
                    viral_title,
                    viral_description,
                    viral_tags,
                    tags,
                    tiktok_url
                )
            `)
            .eq('platform', 'tiktok')
            .eq('status', 'pending')
            .order('clips.ai_score', { ascending: false })
            .limit(10);  // Process up to 10 TikTok videos per run

            // Then filter in JavaScript to maintain quality
            const filteredQueue = tiktokQueue?.filter(item => 
            item.clips && 
            item.clips.ai_score >= 0.40 && 
            !item.clips.tiktok_url
            ) || [];

        if (!ttError && tiktokQueue?.length > 0) {
            console.log(`[DualQueue] Found ${tiktokQueue.length} TikTok clips to process`);
            
            for (const item of tiktokQueue) {
                results.tiktok.attempted++;
                
                // Check user's daily limit
                const limitCheck = await checkUserDailyLimit(item.clips.user_id, 'tiktok');
                if (!limitCheck.canUpload) {
                    console.log(`[DualQueue] User ${item.clips.user_id} reached TikTok daily limit`);
                    
                    // Mark as deferred
                    await supabase
                        .from('publishing_queue')
                        .update({
                            status: 'deferred',
                            last_error: `Daily limit reached (${limitCheck.count}/${limitCheck.limit})`,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', item.id);
                    
                    continue;
                }
                
                // Attempt to publish
                console.log(`[DualQueue] Publishing to TikTok: ${item.clips.title}`);
                // NEW:
                const tiktokResult = await fetch('https://autostreampro.com/.netlify/functions/publish-to-tiktok', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                clipId: item.clip_id,
                userId: item.clips.user_id,
                privacy: 'PUBLIC_TO_EVERYONE'
    })
});
                const success = tiktokResult.ok;
                
                if (success) {
                    results.tiktok.successful++;
                    console.log(`✅ [DualQueue] TikTok upload successful for clip ${item.clip_id}`);
                } else {
                    results.tiktok.failed++;
                    console.log(`❌ [DualQueue] TikTok upload failed for clip ${item.clip_id}`);
                }
                
                // Small delay between uploads
                await delay(2000);
            }
        }

        // Reset deferred items at start of new day
        await resetDeferredItems();

        // Log results
        const summary = `
        📊 Queue Processing Complete:
        YouTube: ${results.youtube.successful}/${results.youtube.attempted} successful
        TikTok: ${results.tiktok.successful}/${results.tiktok.attempted} successful
        `;
        
        console.log(summary);
        
        // Log to analytics
        await supabase
            .from('analytics_events')
            .insert({
                event_type: 'dual_queue_processed',
                event_data: results,
                created_at: new Date().toISOString()
            });

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                results: results,
                message: summary
            })
        };

    } catch (error) {
        console.error('❌ [DualQueue] Processing error:', error);
        
        // Log error
        await supabase
            .from('analytics_events')
            .insert({
                event_type: 'dual_queue_error',
                event_data: { error: error.message },
                created_at: new Date().toISOString()
            });

        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                error: error.message
            })
        };
    }
};

// Helper function to check user's daily upload limits
async function checkUserDailyLimit(userId, platform) {
    const today = new Date().toISOString().split('T')[0];
    
    // Count uploads today
    const { count } = await supabase
        .from('published_content')
        .select('*', { count: 'exact', head: true })
        .eq('clip_id', userId)
        .eq('platform', platform)
        .gte('published_at', today + 'T00:00:00');
    
    // Get user's subscription plan
    const { data: userProfile } = await supabase
        .from('user_profiles')
        .select('subscription_plan')
        .eq('user_id', userId)
        .single();
    
    // Define limits by plan
    const limits = {
        starter: { youtube: 10, tiktok: 10 },
        pro: { youtube: 20, tiktok: 20 },
        enterprise: { youtube: 50, tiktok: 50 }
    };
    
    const plan = userProfile?.subscription_plan || 'starter';
    const limit = limits[plan][platform];
    
    return {
        count: count || 0,
        limit,
        canUpload: (count || 0) < limit
    };
}

// Reset deferred items at start of new day
async function resetDeferredItems() {
    const today = new Date().toISOString().split('T')[0];
    
    // Check if we already reset today
    const { data: lastReset } = await supabase
        .from('analytics_events')
        .select('created_at')
        .eq('event_type', 'queue_deferred_reset')
        .gte('created_at', today + 'T00:00:00')
        .single();
    
    if (lastReset) {
        return; // Already reset today
    }
    
    // Reset all deferred items back to pending
    const { data: resetItems } = await supabase
        .from('publishing_queue')
        .update({
            status: 'pending',
            last_error: null,
            attempts: 0
        })
        .eq('status', 'deferred')
        .select();
    
    if (resetItems?.length > 0) {
        console.log(`[DualQueue] Reset ${resetItems.length} deferred items for new day`);
        
        await supabase
            .from('analytics_events')
            .insert({
                event_type: 'queue_deferred_reset',
                event_data: { reset_count: resetItems.length },
                created_at: new Date().toISOString()
            });
    }
}

// Utility delay function
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}