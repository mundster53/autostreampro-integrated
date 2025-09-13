// netlify/functions/process-clips.js
// ENHANCED VERSION WITH AUTOMATIC SEO

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event, context) => {
    try {
        // Get all pending clips
        const { data: clips } = await supabase
            .from('clips')
            .select('*, user_preferences!inner(viral_threshold)')
            .eq('status', 'pending');
        
        console.log(`Processing ${clips?.length || 0} pending clips`);
        
        for (const clip of clips) {
            const userThreshold = clip.user_preferences.viral_threshold || 0.40;
            
            // Check if clip meets user's threshold
            if (clip.ai_score >= userThreshold) {
                
                // ==========================================
                // NEW: APPLY SEO OPTIMIZATION
                // ==========================================
                try {
                    console.log(`Applying SEO to clip ${clip.id} with score ${clip.ai_score}`);
                    
                    // Call SEO engine
                    const seoResponse = await fetch(`${process.env.URL}/.netlify/functions/seo-engine`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            clipData: {
                                id: clip.id,
                                title: clip.title,
                                description: clip.description,
                                game: clip.game || clip.title?.split(' ')[0], // Extract game from title if not set
                                ai_score: clip.ai_score,
                                tags: clip.tags,
                                duration: clip.duration,
                                highlight: clip.ai_analysis?.highlight,
                                achievement: clip.ai_analysis?.achievement,
                                action: clip.ai_analysis?.action,
                                mode: clip.ai_analysis?.mode
                            },
                            userId: clip.user_id,
                            action: 'enhance'
                        })
                    });
                    
                    const seoResult = await seoResponse.json();
                    
                    if (seoResult.success) {
                        console.log(`SEO applied successfully for clip ${clip.id}`);
                        
                        // Update clip with SEO data
                        await supabase
                            .from('clips')
                            .update({
                                viral_title: seoResult.seo.title,
                                viral_description: seoResult.seo.description,
                                viral_tags: seoResult.seo.hashtags,
                                optimal_post_time: seoResult.seo.postTime,
                                seo_optimized: true,
                                game_name: seoResult.seo.gameName,
                                competition_level: seoResult.seo.competitionLevel
                            })
                            .eq('id', clip.id);
                        
                        // Use SEO-optimized data for posting
                        clip.viral_title = seoResult.seo.title;
                        clip.viral_description = seoResult.seo.description;
                        clip.viral_tags = seoResult.seo.hashtags;
                        clip.tiktok_caption = seoResult.seo.captions?.tiktok;
                        clip.youtube_title = seoResult.seo.captions?.youtube;
                        
                    } else {
                        console.error(`SEO failed for clip ${clip.id}:`, seoResult.error);
                        // Continue with original data if SEO fails
                    }
                    
                } catch (seoError) {
                    console.error(`SEO enhancement error for clip ${clip.id}:`, seoError);
                    // Continue without SEO if it fails
                }
                // ==========================================
                // END OF SEO ENHANCEMENT
                // ==========================================
                
// After SEO enhancement, add CHANNEL GROWTH enhancement
try {
    const channelResponse = await fetch(`${process.env.URL}/.netlify/functions/channel-growth-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'enhance_for_growth',
            userId: clip.user_id,
            clipData: {
                ...clip,
                platform: 'youtube' // or detect from clip
            }
        })
    });
    
    const channelResult = await channelResponse.json();
    
    if (channelResult.success) {
        console.log(`Channel growth enhancements applied to clip ${clip.id}`);
    }
    
} catch (channelError) {
    console.error('Channel growth error:', channelError);
    // Continue anyway
}

                // Post to platforms (now with SEO-optimized content)
                const platforms = [];
                
                // Post to TikTok with SEO caption
                if (clip.user_preferences?.auto_post_tiktok) {
                    // Your TikTok posting will now use clip.tiktok_caption
                    platforms.push('tiktok');
                }
                
                // Post to YouTube with SEO title
                if (clip.user_preferences?.auto_post_youtube) {
                    // Your YouTube posting will now use clip.viral_title
                    platforms.push('youtube');
                }
                
                // Update clip status
                await supabase
                    .from('clips')
                    .update({
                        status: 'published',
                        posted_platforms: platforms,
                        published_at: new Date().toISOString()
                    })
                    .eq('id', clip.id);
                    
                console.log(`Clip ${clip.id} published to: ${platforms.join(', ')}`);
                    
            } else {
                // Mark as below threshold
                await supabase
                    .from('clips')
                    .update({
                        status: 'below_threshold'
                    })
                    .eq('id', clip.id);
                    
                console.log(`Clip ${clip.id} below threshold (${clip.ai_score} < ${userThreshold})`);
            }
        }
        
        return {
            statusCode: 200,
            body: JSON.stringify({ 
                message: 'Clips processed',
                processed: clips?.length || 0
            })
        };
        
    } catch (error) {
        console.error('Process clips error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};