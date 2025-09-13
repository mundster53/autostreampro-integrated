// netlify/functions/process-clip-with-seo.js
// INTEGRATION: Connects SEO to your existing clip processing

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// This wraps your existing clip processing with SEO
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { clipId, userId, aiScore } = JSON.parse(event.body);

        // 1. Get the clip data
        const { data: clipData, error: clipError } = await supabase
            .from('clips')
            .select('*')
            .eq('id', clipId)
            .single();

        if (clipError) throw clipError;

        // 2. Only process clips that meet threshold
        if (aiScore < 0.4) {
            console.log('Clip below threshold, skipping SEO');
            return {
                statusCode: 200,
                body: JSON.stringify({ 
                    success: true, 
                    message: 'Clip below threshold',
                    seoApplied: false 
                })
            };
        }

        // 3. Call the SEO engine
        const seoResponse = await fetch(`${process.env.URL}/.netlify/functions/seo-engine`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clipData: {
                    ...clipData,
                    ai_score: aiScore
                },
                userId: userId,
                action: 'enhance'
            })
        });

        const seoResult = await seoResponse.json();

        if (!seoResult.success) {
            console.error('SEO enhancement failed:', seoResult.error);
            // Continue with fallback SEO
        }

        // 4. Update clip with SEO data
        const { error: updateError } = await supabase
            .from('clips')
            .update({
                viral_title: seoResult.seo?.title || clipData.title,
                viral_description: seoResult.seo?.description || clipData.description,
                viral_tags: seoResult.seo?.hashtags || ['#gaming'],
                optimal_post_time: seoResult.seo?.postTime,
                seo_optimized: true,
                seo_score: calculateSEOScore(seoResult.seo),
                game_name: seoResult.seo?.gameName,
                competition_level: seoResult.seo?.competitionLevel
            })
            .eq('id', clipId);

        if (updateError) {
            console.error('Update error:', updateError);
        }

        // 5. Schedule for optimal posting
        if (seoResult.seo?.postTime) {
            await schedulePost(clipId, seoResult.seo.postTime, userId);
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                message: 'SEO optimization complete',
                seo: seoResult.seo,
                clipId: clipId
            })
        };

    } catch (error) {
        console.error('Processing error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: error.message,
                success: false 
            })
        };
    }
};

// Calculate SEO score (0-1)
function calculateSEOScore(seo) {
    if (!seo) return 0;
    
    let score = 0;
    
    // Title optimization (30%)
    if (seo.title) {
        if (seo.title.length >= 50 && seo.title.length <= 70) score += 0.15;
        if (seo.title.includes('🔥') || seo.title.includes('😱')) score += 0.05;
        if (/\d+/.test(seo.title)) score += 0.05; // Contains numbers
        if (seo.title.includes(seo.gameName)) score += 0.05;
    }
    
    // Description (20%)
    if (seo.description) {
        if (seo.description.length > 100) score += 0.10;
        if (seo.description.includes('Subscribe')) score += 0.05;
        if (seo.description.includes('#')) score += 0.05;
    }
    
    // Hashtags (30%)
    if (seo.hashtags) {
        if (seo.hashtags.length >= 5) score += 0.15;
        if (seo.hashtags.length <= 15) score += 0.15;
    }
    
    // Timing (20%)
    if (seo.postTime) {
        score += 0.20;
    }
    
    return Math.min(score, 1);
}

// Schedule post for optimal time
async function schedulePost(clipId, postTime, userId) {
    try {
        // Check if already in publishing queue
        const { data: existing } = await supabase
            .from('publishing_queue')
            .select('id')
            .eq('clip_id', clipId)
            .single();

        if (existing) {
            // Update existing
            await supabase
                .from('publishing_queue')
                .update({
                    scheduled_time: postTime,
                    status: 'scheduled'
                })
                .eq('clip_id', clipId);
        } else {
            // Create new
            await supabase
                .from('publishing_queue')
                .insert({
                    clip_id: clipId,
                    user_id: userId,
                    scheduled_time: postTime,
                    status: 'scheduled',
                    platforms: ['youtube', 'tiktok']
                });
        }
        
        return true;
    } catch (error) {
        console.error('Scheduling error:', error);
        return false;
    }
}