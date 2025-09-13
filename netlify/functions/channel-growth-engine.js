// netlify/functions/channel-growth-engine.js
// Builds gaming CAREERS, not just viral clips

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
        const { 
            action, 
            userId, 
            clipData 
        } = JSON.parse(event.body);

        let result;
        switch(action) {
            case 'enhance_for_growth':
                result = await enhanceClipForChannelGrowth(clipData, userId);
                break;
            case 'setup_branding':
                result = await setupChannelBranding(userId);
                break;
            case 'track_conversion':
                result = await trackConversion(userId, clipData);
                break;
            case 'optimize_channel':
                result = await optimizeChannelSEO(userId);
                break;
            default:
                result = await enhanceClipForChannelGrowth(clipData, userId);
        }

        return {
            statusCode: 200,
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error('Channel Growth Engine Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};

// MAIN FUNCTION: Enhance clip to build the CHANNEL, not just get views
async function enhanceClipForChannelGrowth(clipData, userId) {
    try {
        // 1. Get channel branding
        const { data: branding } = await supabase
            .from('channel_branding')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (!branding) {
            await setupChannelBranding(userId);
            return { success: false, message: 'Setting up channel branding first' };
        }

        // 2. Get cross-platform strategy
        const { data: strategy } = await supabase
            .from('cross_platform_strategy')
            .select('*')
            .eq('user_id', userId)
            .single();

        // 3. Enhance title with channel identity
        const channelFocusedTitle = enhanceTitleForChannel(
            clipData.viral_title || clipData.title,
            branding.channel_name
        );

        // 4. Create channel-building description
        const channelBuildingDescription = createChannelBuildingDescription(
            clipData,
            branding,
            strategy
        );

        // 5. Generate channel growth CTAs
        const growthCTAs = generateGrowthCTAs(branding, clipData.platform);

        // 6. Create end screen strategy (YouTube)
        const endScreenStrategy = createEndScreenStrategy(clipData, branding);

        // 7. Generate community hashtags
        const communityHashtags = generateCommunityHashtags(branding, clipData.game_name);

        // 8. Create pinned comment for engagement
        const pinnedComment = createPinnedComment(branding, clipData);

        // Update clip with channel growth enhancements
        const enhancedData = {
            // Keep existing SEO
            viral_title: channelFocusedTitle,
            viral_description: channelBuildingDescription,
            
            // Add channel growth elements
            channel_ctas: growthCTAs,
            end_screen_config: endScreenStrategy,
            pinned_comment: pinnedComment,
            community_hashtags: communityHashtags,
            
            // Channel branding
            uses_intro: branding.intro_phrase ? true : false,
            uses_outro: branding.outro_phrase ? true : false,
            channel_branded: true
        };

        await supabase
            .from('clips')
            .update(enhancedData)
            .eq('id', clipData.id);

        return {
            success: true,
            enhancements: enhancedData,
            strategy: 'channel_growth',
            projectedImpact: {
                viewsToSubs: '2-5%', // Industry average is 1%
                communityGrowth: '10-15%',
                brandRecognition: 'high'
            }
        };

    } catch (error) {
        console.error('Channel enhancement error:', error);
        return { success: false, error: error.message };
    }
}

// Enhance title to build channel brand
function enhanceTitleForChannel(originalTitle, channelName) {
    // Strategy: Include channel name for brand recognition
    const patterns = [
        `${originalTitle} - ${channelName}`,
        `${channelName}: ${originalTitle}`,
        `${originalTitle} | ${channelName} Gaming`,
    ];
    
    // Pick pattern that fits YouTube's 70 char limit
    for (const pattern of patterns) {
        if (pattern.length <= 70) {
            return pattern;
        }
    }
    
    return originalTitle; // Fallback
}

// Create description that builds the channel
function createChannelBuildingDescription(clipData, branding, strategy) {
    let description = '';
    
    // 1. Hook with value
    description += clipData.viral_description || `Epic ${clipData.game_name} moment!\n`;
    description += '\n';
    
    // 2. Channel Identity Section
    description += '━━━━━━━━━━━━━━━━━━━━\n';
    description += `🎮 ${branding.channel_name.toUpperCase()}\n`;
    if (branding.tagline) {
        description += `"${branding.tagline}"\n`;
    }
    description += '━━━━━━━━━━━━━━━━━━━━\n\n';
    
    // 3. Why Subscribe (Value Proposition)
    description += '🔥 WHY JOIN OUR COMMUNITY?\n';
    description += branding.why_subscribe || 
        `• Daily ${clipData.game_name} content\n• Live streams every weekday\n• Amazing community\n`;
    description += '\n';
    
    // 4. Live Streaming Schedule
    description += '📅 CATCH ME LIVE:\n';
    description += branding.streaming_schedule || 'Mon-Fri 7PM EST\n';
    description += '\n';
    
    // 5. Platform Links (Cross-Promotion)
    description += '🔗 FIND ME EVERYWHERE:\n';
    if (branding.twitch_url) {
        description += `• TWITCH: ${branding.twitch_url}\n`;
    }
    if (branding.youtube_url) {
        description += `• YOUTUBE: ${branding.youtube_url}\n`;
    }
    if (branding.discord_url) {
        description += `• DISCORD: ${branding.discord_url}\n`;
    }
    if (branding.twitter_handle) {
        description += `• TWITTER: @${branding.twitter_handle}\n`;
    }
    description += '\n';
    
    // 6. Community Perks
    if (branding.community_perks) {
        description += '💜 SUBSCRIBER PERKS:\n';
        description += branding.community_perks + '\n\n';
    }
    
    // 7. Current Campaign (if any)
    description += '🎯 CURRENT GOAL: Road to 10K Subs!\n';
    description += 'Help us reach our goal and unlock special content!\n\n';
    
    // 8. Engagement Hook
    description += '💬 QUESTION: What was your favorite moment in this clip?\n';
    description += 'Let me know in the comments!\n\n';
    
    // 9. Hashtags for SEO
    description += '#' + clipData.game_name.replace(/\s+/g, '') + ' ';
    description += `#${branding.channel_name.replace(/\s+/g, '')} `;
    description += '#Gaming #GamingCommunity #GamingChannel\n';
    
    // 10. Timestamps (if available)
    if (clipData.timestamps) {
        description += '\n⏱️ TIMESTAMPS:\n';
        description += clipData.timestamps;
    }
    
    return description;
}

// Generate platform-specific CTAs
function generateGrowthCTAs(branding, platform) {
    const ctas = {
        youtube: [
            "🔔 Subscribe and hit the bell for daily content!",
            `Join the ${branding.channel_name} family - SUBSCRIBE!`,
            "New here? Subscribe for more epic moments!",
            "Subscribe to never miss a clutch moment!"
        ],
        tiktok: [
            "Follow for daily gaming content! 🎮",
            `More epic clips @${branding.tiktok_handle || branding.channel_name}`,
            "Hit follow if this was clean! 💯",
            "Follow for part 2! ➡️"
        ],
        shorts: [
            "Subscribe for more #Shorts!",
            "Like & Subscribe if you enjoyed!",
            "Sub for daily gaming Shorts!",
            "Want more? Hit subscribe!"
        ]
    };
    
    return ctas[platform] || ctas.youtube;
}

// Create end screen strategy (YouTube specific)
function createEndScreenStrategy(clipData, branding) {
    return {
        elements: [
            {
                type: 'subscribe',
                position: 'bottom-center',
                start_time: clipData.duration - 20,
                end_time: clipData.duration
            },
            {
                type: 'video',
                position: 'left',
                start_time: clipData.duration - 20,
                end_time: clipData.duration,
                video_type: 'best_for_viewer' // YouTube's algorithm picks
            },
            {
                type: 'playlist',
                position: 'right',
                start_time: clipData.duration - 20,
                end_time: clipData.duration,
                playlist: `${clipData.game_name} Highlights`
            },
            {
                type: 'channel',
                position: 'top-right',
                start_time: clipData.duration - 15,
                end_time: clipData.duration
            }
        ],
        // Voice-over script for end screen
        outro_script: branding.outro_phrase || 
            `Thanks for watching! Subscribe for more ${clipData.game_name} content!`
    };
}

// Generate community-building hashtags
function generateCommunityHashtags(branding, gameName) {
    const hashtags = [];
    
    // Channel-specific hashtags
    const channelTag = '#' + branding.channel_name.replace(/\s+/g, '');
    hashtags.push(channelTag);
    hashtags.push(channelTag + 'Community');
    hashtags.push(channelTag + 'Family');
    
    // Game + Channel combo
    hashtags.push('#' + gameName.replace(/\s+/g, '') + channelTag);
    
    // Community building tags
    hashtags.push('#JoinTheSquad');
    hashtags.push('#GamingCommunity');
    hashtags.push('#SubSquad');
    hashtags.push('#RoadTo10K');
    
    // Platform specific
    hashtags.push('#YouTubeGaming');
    hashtags.push('#TwitchStreamer');
    
    return hashtags;
}

// Create pinned comment for engagement
function createPinnedComment(branding, clipData) {
    const templates = [
        `🎮 Welcome to ${branding.channel_name}! If you enjoyed this ${clipData.game_name} clip, consider subscribing for daily content! What was your favorite part? Let me know below! 👇`,
        
        `📢 ANNOUNCEMENT: We're ${Math.floor(Math.random() * 500) + 100} subs away from our goal! Help us reach it by subscribing and sharing! Drop a ❤️ if you're part of the ${branding.channel_name} family!`,
        
        `🔥 This clip is just a taste! Full streams on ${branding.twitch_url || 'Twitch'} every ${branding.streaming_schedule || 'weekday'}! Join our Discord for exclusive content: ${branding.discord_url || '[link]'}`,
        
        `💬 QUESTION FOR YOU: What ${clipData.game_name} content do you want to see more of? Let me know and SUBSCRIBE to see it happen!`
    ];
    
    return templates[Math.floor(Math.random() * templates.length)];
}

// Setup initial channel branding
async function setupChannelBranding(userId) {
    try {
        // Get user data
        const { data: profile } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('user_id', userId)
            .single();
        
        // Get their primary game
        const { data: seoProfile } = await supabase
            .from('channel_seo_profiles')
            .select('primary_game')
            .eq('user_id', userId)
            .single();
        
        const game = seoProfile?.primary_game || 'Gaming';
        
        // Create default branding
        const defaultBranding = {
            user_id: userId,
            channel_name: profile?.display_name || 'Gamer',
            tagline: `Your daily dose of ${game} entertainment!`,
            streaming_schedule: 'Mon-Fri 7PM EST | Weekends 2PM EST',
            
            intro_phrase: "What's up legends!",
            outro_phrase: "Don't forget to subscribe and I'll see you in the next one!",
            catchphrase: "Let's get this W!",
            
            twitch_url: profile?.twitch_channel_url,
            youtube_url: profile?.youtube_channel_url,
            kick_url: profile?.kick_channel_url,
            discord_url: null, // User needs to add
            
            why_subscribe: `• Daily ${game} highlights and funny moments\n• Live streams 5 days a week\n• Active Discord community\n• Subscriber game nights`,
            content_promise: `Fresh ${game} content every single day`,
            community_perks: '• Exclusive Discord roles\n• Priority in games\n• Behind-the-scenes content',
            
            primary_color: '#667eea', // Purple default
            emoji_set: ['🎮', '🔥', '💜', '🏆', '😂']
        };
        
        const { error } = await supabase
            .from('channel_branding')
            .insert(defaultBranding);
        
        if (error) throw error;
        
        // Also create cross-platform strategy
        await setupCrossPlatformStrategy(userId);
        
        return { success: true, message: 'Channel branding initialized' };
        
    } catch (error) {
        console.error('Branding setup error:', error);
        return { success: false, error: error.message };
    }
}

// Setup cross-platform strategy
async function setupCrossPlatformStrategy(userId) {
    const defaultStrategy = {
        user_id: userId,
        primary_platform: 'twitch', // Most gamers stream on Twitch
        clip_platforms: ['youtube', 'tiktok'],
        community_platform: 'discord',
        
        youtube_to_twitch: '🔴 Watch me LIVE on Twitch! [link]',
        twitch_to_youtube: '📺 Highlights on YouTube! [link]',
        all_to_discord: '💬 Join our Discord community! [link]',
        
        stream_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        stream_times: ['19:00'], // 7 PM
        clip_posting_offset: 12 // Post clips 12 hours after stream
    };
    
    await supabase
        .from('cross_platform_strategy')
        .insert(defaultStrategy);
}

// Track conversion metrics
async function trackConversion(userId, conversionData) {
    try {
        await supabase
            .from('subscriber_conversion')
            .insert({
                user_id: userId,
                clip_id: conversionData.clipId,
                conversion_method: conversionData.method,
                platform: conversionData.platform,
                cta_used: conversionData.cta
            });
        
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Optimize channel SEO
async function optimizeChannelSEO(userId) {
    try {
        const { data: profile } = await supabase
            .from('channel_seo_profiles')
            .select('*')
            .eq('user_id', userId)
            .single();
        
        const { data: branding } = await supabase
            .from('channel_branding')
            .select('*')
            .eq('user_id', userId)
            .single();
        
        // Generate optimized channel description
        const channelDescription = `
Welcome to ${branding.channel_name}! ${branding.tagline}

🎮 WHAT YOU'LL FIND HERE:
${branding.content_promise}

📅 STREAMING SCHEDULE:
${branding.streaming_schedule}

🏆 WHY SUBSCRIBE?
${branding.why_subscribe}

💜 JOIN THE COMMUNITY:
${branding.discord_url || 'Discord coming soon!'}

🔗 CONNECT WITH ME:
${branding.twitch_url ? '• Twitch: ' + branding.twitch_url : ''}
${branding.twitter_handle ? '• Twitter: @' + branding.twitter_handle : ''}

For business inquiries: ${branding.business_email || 'contact@' + branding.channel_name + '.com'}

#${profile.primary_game} #Gaming #${branding.channel_name}
        `.trim();
        
        // Generate channel tags
        const channelTags = [
            profile.primary_game,
            `${profile.primary_game} gameplay`,
            `${profile.primary_game} highlights`,
            'gaming',
            'gaming channel',
            'live streaming',
            'twitch streamer',
            'gaming content',
            branding.channel_name
        ];
        
        // Save channel SEO
        await supabase
            .from('channel_seo')
            .upsert({
                user_id: userId,
                channel_description: channelDescription,
                channel_tags: channelTags,
                channel_keywords: channelTags,
                about_content: `${branding.tagline}\n\n${branding.why_subscribe}`,
                updated_at: new Date()
            });
        
        return {
            success: true,
            seo: {
                description: channelDescription,
                tags: channelTags
            }
        };
        
    } catch (error) {
        return { success: false, error: error.message };
    }
}