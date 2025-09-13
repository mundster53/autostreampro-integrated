// netlify/functions/initialize-seo-profile.js
// Automatically sets up SEO for new users

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { userId, gamePreferences, contentType, timezone } = JSON.parse(event.body);

        console.log(`Initializing SEO for user ${userId}, game: ${gamePreferences}`);

        // 1. Create SEO Profile
        const { data: seoProfile, error: profileError } = await supabase
            .from('channel_seo_profiles')
            .upsert({
                user_id: userId,
                primary_game: gamePreferences || contentType || 'gaming',
                content_style: detectContentStyle(contentType),
                channel_keywords: generateInitialKeywords(gamePreferences || contentType),
                game_competition_level: 'medium', // Will be updated on first clip
                created_at: new Date(),
                updated_at: new Date()
            })
            .select()
            .single();

        if (profileError) {
            console.error('Profile creation error:', profileError);
            throw profileError;
        }

        // 2. Setup Posting Schedule for each platform
        const platforms = ['youtube', 'tiktok'];
        const schedules = [];

        for (const platform of platforms) {
            const optimalTimes = getOptimalTimesForPlatform(platform);
            
            schedules.push({
                user_id: userId,
                platform: platform,
                timezone: timezone || 'America/Chicago',
                weekday_slots: optimalTimes.weekday,
                weekend_slots: optimalTimes.weekend,
                max_posts_per_day: platform === 'tiktok' ? 4 : 3,
                posts_today: 0
            });
        }

        const { error: scheduleError } = await supabase
            .from('optimal_posting_schedule')
            .upsert(schedules);

        if (scheduleError) {
            console.error('Schedule creation error:', scheduleError);
        }

        // 3. Pre-generate hashtags for their game
        const gameName = gamePreferences || contentType || 'gaming';
        
        // Call database function to generate hashtags
        const { data: hashtags } = await supabase
            .rpc('generate_game_hashtags', { 
                p_game_name: gameName,
                p_competition_level: null // Auto-detect
            });

        // Cache the hashtags
        await supabase
            .from('dynamic_hashtags')
            .upsert({
                user_id: userId,
                game_name: gameName,
                generated_hashtags: hashtags,
                last_rotation_index: 0
            });

        // 4. Create initial playlists structure
        const playlists = [
            {
                user_id: userId,
                playlist_name: `Best ${gameName} Moments`,
                playlist_type: 'game',
                auto_add_rules: { min_score: 0.4, games: [gameName] }
            },
            {
                user_id: userId,
                playlist_name: 'Viral Clips 🔥',
                playlist_type: 'viral',
                auto_add_rules: { min_score: 0.7 }
            },
            {
                user_id: userId,
                playlist_name: 'This Week\'s Highlights',
                playlist_type: 'weekly',
                auto_add_rules: { days: 7 }
            }
        ];

        await supabase
            .from('youtube_playlists')
            .upsert(playlists);

        // 5. Initialize game intelligence if new game
        const { data: existingGame } = await supabase
            .from('game_intelligence')
            .select('game_name')
            .eq('game_name', gameName)
            .single();

        if (!existingGame) {
            await supabase
                .from('game_intelligence')
                .insert({
                    game_name: gameName,
                    game_name_normalized: gameName.toLowerCase().replace(/[^a-z0-9]/g, ''),
                    competition_score: 0.5, // Default, will learn
                    estimated_creators: 0,
                    created_at: new Date()
                });
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                message: 'SEO profile initialized',
                profile: {
                    userId: userId,
                    game: gameName,
                    seoReady: true,
                    hashtagsGenerated: !!hashtags,
                    playlistsCreated: playlists.length
                }
            })
        };

    } catch (error) {
        console.error('SEO initialization error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: error.message,
                success: false
            })
        };
    }
};

// Detect content style from user selection
function detectContentStyle(contentType) {
    if (!contentType) return 'general';
    
    const lowerContent = contentType.toLowerCase();
    
    if (lowerContent.includes('funny') || lowerContent.includes('fail')) {
        return 'funny';
    }
    if (lowerContent.includes('competitive') || lowerContent.includes('ranked')) {
        return 'competitive';
    }
    if (lowerContent.includes('tutorial') || lowerContent.includes('guide')) {
        return 'tutorial';
    }
    if (lowerContent.includes('pro') || lowerContent.includes('esports')) {
        return 'pro';
    }
    
    return 'general';
}

// Generate initial keywords for the channel
function generateInitialKeywords(game) {
    const gameClean = game.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    return [
        'gaming',
        'gameplay',
        'gamer',
        game,
        `${game} gameplay`,
        `${game} clips`,
        `${game} highlights`,
        `${gameClean}`,
        'gaming clips',
        'gaming content'
    ];
}

// Get optimal posting times for each platform
function getOptimalTimesForPlatform(platform) {
    const times = {
        youtube: {
            weekday: [14, 17, 20], // 2pm, 5pm, 8pm
            weekend: [10, 14, 20]  // 10am, 2pm, 8pm
        },
        tiktok: {
            weekday: [6, 12, 19, 22], // 6am, noon, 7pm, 10pm
            weekend: [9, 12, 19, 22]  // 9am, noon, 7pm, 10pm
        },
        twitch: {
            weekday: [16, 19, 21], // 4pm, 7pm, 9pm
            weekend: [12, 16, 20]  // noon, 4pm, 8pm
        }
    };
    
    return times[platform] || times.youtube;
}