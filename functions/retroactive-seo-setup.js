// netlify/functions/retroactive-seo-setup.js
// Applies SEO to existing users who joined before SEO launch

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
    try {
        const { userId, processOldClips = false } = JSON.parse(event.body);
        
        console.log(`Setting up retroactive SEO for user: ${userId}`);
        
        // 1. Check if user already has SEO profile
        const { data: existingProfile } = await supabase
            .from('channel_seo_profiles')
            .select('id')
            .eq('user_id', userId)
            .single();
        
        if (existingProfile) {
            console.log('User already has SEO profile');
        } else {
            // 2. Get user's existing data
            const { data: userPrefs } = await supabase
                .from('user_preferences')
                .select('*')
                .eq('user_id', userId)
                .single();
            
            const { data: userProfile } = await supabase
                .from('user_profiles')
                .select('*')
                .eq('user_id', userId)
                .single();
            
            // 3. Create SEO profile
            await supabase
                .from('channel_seo_profiles')
                .insert({
                    user_id: userId,
                    primary_game: userPrefs?.content_type || 'gaming',
                    content_style: 'general',
                    channel_keywords: ['gaming', 'gameplay', 'clips'],
                    game_competition_level: 'medium'
                });
            
            // 4. Setup posting schedule
            await supabase
                .from('optimal_posting_schedule')
                .insert([
                    {
                        user_id: userId,
                        platform: 'youtube',
                        timezone: 'America/Chicago',
                        weekday_slots: [14, 17, 20],
                        weekend_slots: [10, 14, 20]
                    },
                    {
                        user_id: userId,
                        platform: 'tiktok',
                        timezone: 'America/Chicago',
                        weekday_slots: [6, 12, 19, 22],
                        weekend_slots: [9, 12, 19, 22]
                    }
                ]);
            
            // 5. Setup channel branding
            await supabase
                .from('channel_branding')
                .insert({
                    user_id: userId,
                    channel_name: userProfile?.display_name || 'Duncan Gaming',
                    tagline: 'Epic gaming moments daily!',
                    streaming_schedule: 'Check Twitch for schedule',
                    twitch_url: userProfile?.twitch_channel_url,
                    youtube_url: userProfile?.youtube_channel_url,
                    kick_url: userProfile?.kick_channel_url,
                    why_subscribe: '• Daily gaming highlights\n• Multi-game content\n• Community focused',
                    content_promise: 'Fresh gaming content every day'
                });
        }
        
        // 6. Process old clips if requested
        if (processOldClips) {
            const { data: oldClips } = await supabase
                .from('clips')
                .select('*')
                .eq('user_id', userId)
                .eq('seo_optimized', false)
                .limit(50); // Process in batches
            
            console.log(`Found ${oldClips?.length || 0} clips to optimize`);
            
            for (const clip of oldClips || []) {
                // Apply SEO to each old clip
                await applyRetroactiveSEO(clip, userId);
            }
        }
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: `SEO setup complete for user ${userId}`,
                clipsProcessed: processOldClips ? oldClips?.length : 0
            })
        };
        
    } catch (error) {
        console.error('Retroactive SEO error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};

async function applyRetroactiveSEO(clip, userId) {
    try {
        // Call SEO engine for this clip
        const response = await fetch(`${process.env.URL}/.netlify/functions/seo-engine`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clipData: clip,
                userId: userId,
                action: 'enhance'
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Update clip with SEO data
            await supabase
                .from('clips')
                .update({
                    viral_title: result.seo.title,
                    viral_description: result.seo.description,
                    viral_tags: result.seo.hashtags,
                    seo_optimized: true,
                    game_name: result.seo.gameName,
                    competition_level: result.seo.competitionLevel
                })
                .eq('id', clip.id);
            
            console.log(`SEO applied to clip ${clip.id}`);
        }
        
    } catch (error) {
        console.error(`Failed to optimize clip ${clip.id}:`, error);
    }
}