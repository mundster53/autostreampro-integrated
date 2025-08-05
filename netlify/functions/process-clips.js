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
        
        for (const clip of clips) {
            const userThreshold = clip.user_preferences.viral_threshold || 0.40;
            
            // Check if clip meets user's threshold
            if (clip.ai_score >= userThreshold) {
                // Post to platforms
                const platforms = [];
                
                // Post to TikTok
                if (clip.user_preferences.auto_post_tiktok) {
                    // Call your post-to-tiktok function
                    platforms.push('tiktok');
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
                    
            } else {
                // Mark as below threshold
                await supabase
                    .from('clips')
                    .update({
                        status: 'below_threshold'
                    })
                    .eq('id', clip.id);
            }
        }
        
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Clips processed' })
        };
        
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
