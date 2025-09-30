// netlify/functions/initialize-seo-profile.js
// ENHANCED VERSION - Adds full channel SEO to existing setup

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

        // Get user's existing profile data
        const { data: userProfile } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('user_id', userId)
            .single();

        // 1. Create SEO Profile (existing code)
        const { data: seoProfile } = await supabase
            .from('channel_seo_profiles')
            .upsert({
                user_id: userId,
                primary_game: gamePreferences || contentType || 'gaming',
                content_style: detectContentStyle(contentType),
                channel_keywords: generateInitialKeywords(gamePreferences || contentType),
                game_competition_level: 'medium'
            })
            .select()
            .single();

        // 2. Setup Posting Schedule (existing code)
        await setupOptimalSchedules(userId, timezone || 'America/Chicago');

        // 3. Pre-generate hashtags (existing code)
        await setupHashtagSets(gamePreferences || contentType || 'gaming', userId);

        // 4. Create playlists (existing code)
        await createInitialPlaylists(userId, gamePreferences || contentType);

        // ========================================
        // NEW: FULL CHANNEL SEO AUTOMATION
        // ========================================
        
        // 5. Generate channel branding with SEO focus
        const channelName = userProfile?.youtube_channel_url?.split('/').pop() || 
                           userProfile?.twitch_channel_url?.split('/').pop() || 
                           'GamingChannel';
        
        await generateChannelBranding(userId, channelName, gamePreferences || contentType);
        
        // 6. Generate full channel SEO content
        await generateChannelSEOContent(userId, channelName, gamePreferences || contentType, userProfile);
        
        // 7. Setup cross-platform strategy
        await setupCrossPlatformStrategy(userId, userProfile);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                message: 'Complete SEO profile initialized',
                profile: {
                    userId: userId,
                    game: gamePreferences,
                    seoReady: true,
                    channelOptimized: true
                }
            })
        };

    } catch (error) {
        console.error('SEO initialization error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};

// Generate complete channel branding
async function generateChannelBranding(userId, channelName, game) {
    const branding = {
        user_id: userId,
        channel_name: channelName,
        tagline: `Your daily dose of ${game} entertainment!`,
        streaming_schedule: 'Mon-Fri 7PM CST | Weekends 2PM CST',
        
        intro_phrase: `What's up ${game} fans!`,
        outro_phrase: `Don't forget to subscribe for daily ${game} content!`,
        catchphrase: `Let's get this W!`,
        
        why_subscribe: `• Daily ${game} highlights
- Live streams 5x per week
- Active Discord community
- Exclusive subscriber perks`,
        
        content_promise: `Fresh ${game} content every single day`,
        community_perks: '• Exclusive Discord roles\n• Play with subscribers\n• Early access to content',
        
        primary_color: '#667eea',
        emoji_set: ['🎮', '🔥', '💜', '🏆', '😂']
    };
    
    await supabase
        .from('channel_branding')
        .upsert(branding);
    
    return branding;
}

// Generate full channel SEO content
async function generateChannelSEOContent(userId, channelName, game, userProfile) {
    
    // Generate optimized channel description
    const channelDescription = `Welcome to ${channelName} - Your #1 Source for ${game} Content! 🎮

🏆 WHAT MAKES THIS CHANNEL SPECIAL:
- Daily ${game} highlights and epic moments
- Pro tips and strategies to improve your gameplay
- Live commentary and reactions
- Community-driven content

📅 UPLOAD SCHEDULE:
- New clips: Daily at 2PM, 5PM & 8PM CST
- Live streams: Mon-Fri 7PM CST
- Special events: Weekends

🚀 POWERED BY AUTOSTREAMPRO
This channel uses cutting-edge AI technology to capture and share the best gaming moments automatically!

🔗 CONNECT WITH ME:
${userProfile?.twitch_channel_url ? '• Twitch: ' + userProfile.twitch_channel_url + '\n' : ''}${userProfile?.kick_channel_url ? '• Kick: ' + userProfile.kick_channel_url + '\n' : ''}• Discord: Join our community!

💼 Business: contact@${channelName.toLowerCase()}.com

🏷️ TAGS:
#${game} #${game}Gameplay #${game}Clips #Gaming #GamingChannel #${channelName}

Subscribe and hit the bell to join the ${channelName} family!`;

    // Generate channel tags
    const channelTags = [
        game.toLowerCase(),
        `${game} gameplay`,
        `${game} clips`,
        `${game} highlights`,
        `${game} channel`,
        `${game} content`,
        'gaming',
        'gaming channel',
        'gameplay',
        'live streaming',
        'gaming content',
        channelName.toLowerCase(),
        `${channelName} gaming`,
        'autostreampro'
    ];

    // Generate channel keywords for YouTube Studio
    const channelKeywords = [
        channelName,
        `${channelName} ${game}`,
        `${game} gameplay`,
        `best ${game} clips`,
        `${game} highlights`,
        `${game} pro player`,
        `${game} tips`,
        `daily ${game}`,
        'gaming content creator',
        'autostreampro'
    ];

    // Save to channel_seo table
    await supabase
        .from('channel_seo')
        .upsert({
            user_id: userId,
            channel_description: channelDescription,
            channel_tags: channelTags,
            channel_keywords: channelKeywords,
            about_content: `${channelName} - ${game} Content Creator
            
Bringing you the best ${game} content daily through AI-powered clip creation with AutoStreamPro.

Schedule: Mon-Fri 7PM CST
Business: contact@${channelName.toLowerCase()}.com`,
            business_email: `contact@${channelName.toLowerCase()}.com`,
            updated_at: new Date()
        });

    return {
        description: channelDescription,
        tags: channelTags,
        keywords: channelKeywords
    };
}

// Setup cross-platform strategy
async function setupCrossPlatformStrategy(userId, userProfile) {
    const strategy = {
        user_id: userId,
        primary_platform: 'twitch', // Most gamers stream here
        clip_platforms: ['youtube', 'tiktok'],
        community_platform: 'discord',
        
        youtube_to_twitch: `🔴 Watch me LIVE on Twitch: ${userProfile?.twitch_channel_url || '[link]'}`,
        twitch_to_youtube: `📺 Daily highlights on YouTube: ${userProfile?.youtube_channel_url || '[link]'}`,
        all_to_discord: '💬 Join our Discord community: [link]',
        
        stream_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        stream_times: ['19:00'],
        clip_posting_offset: 12
    };
    
    await supabase
        .from('cross_platform_strategy')
        .upsert(strategy);
    
    return strategy;
}

// Helper functions (existing)
function detectContentStyle(contentType) {
    if (!contentType) return 'general';
    const lower = contentType.toLowerCase();
    if (lower.includes('funny') || lower.includes('fail')) return 'funny';
    if (lower.includes('competitive') || lower.includes('ranked')) return 'competitive';
    if (lower.includes('tutorial') || lower.includes('guide')) return 'tutorial';
    if (lower.includes('pro') || lower.includes('esports')) return 'pro';
    return 'general';
}

function generateInitialKeywords(game) {
    const gameClean = game.toLowerCase().replace(/[^a-z0-9]/g, '');
    return [
        'gaming', 'gameplay', 'gamer',
        game, `${game} gameplay`, `${game} clips`,
        `${game} highlights`, gameClean,
        'gaming clips', 'gaming content'
    ];
}

async function setupOptimalSchedules(userId, timezone) {
    const schedules = [
        {
            user_id: userId,
            platform: 'youtube',
            timezone: timezone,
            weekday_slots: [14, 17, 20],
            weekend_slots: [10, 14, 20]
        },
        {
            user_id: userId,
            platform: 'tiktok',
            timezone: timezone,
            weekday_slots: [6, 12, 19, 22],
            weekend_slots: [9, 12, 19, 22]
        }
    ];
    
    await supabase
        .from('optimal_posting_schedule')
        .upsert(schedules);
}

async function setupHashtagSets(gameName, userId) {
    // Call existing function to generate hashtags
    const { data: hashtags } = await supabase
        .rpc('generate_game_hashtags', { 
            p_game_name: gameName,
            p_competition_level: null
        });

    await supabase
        .from('dynamic_hashtags')
        .upsert({
            user_id: userId,
            game_name: gameName,
            generated_hashtags: hashtags,
            last_rotation_index: 0
        });
}

async function createInitialPlaylists(userId, gameName) {
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
}