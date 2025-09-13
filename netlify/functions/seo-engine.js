// netlify/functions/seo-engine.js
// UNIVERSAL SEO ENGINE - Works for ANY game automatically

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// Main SEO Enhancement Function
exports.handler = async (event) => {
    // Only accept POST requests
    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            body: JSON.stringify({ error: 'Method not allowed' }) 
        };
    }

    try {
        const { 
            clipData, 
            userId, 
            action = 'enhance' // 'enhance', 'analyze', 'learn'
        } = JSON.parse(event.body);

        // Route to appropriate function
        let result;
        switch(action) {
            case 'enhance':
                result = await enhanceClipSEO(clipData, userId);
                break;
            case 'analyze':
                result = await analyzePerformance(clipData, userId);
                break;
            case 'learn':
                result = await learnFromResults(clipData, userId);
                break;
            default:
                result = await enhanceClipSEO(clipData, userId);
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error('SEO Engine Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: error.message,
                fallback: getFallbackSEO() 
            })
        };
    }
};

// MAIN FUNCTION: Enhance any clip with SEO
async function enhanceClipSEO(clipData, userId) {
    try {
        // 1. Detect or get game name
        const gameName = clipData.game || clipData.title?.match(/\b(\w+)\b/)?.[1] || 'gaming';
        
        // 2. Get user's SEO profile (or create one)
        let { data: seoProfile } = await supabase
            .from('channel_seo_profiles')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (!seoProfile) {
            // Auto-create profile for new users
            const { data: newProfile } = await supabase
                .from('channel_seo_profiles')
                .insert({
                    user_id: userId,
                    primary_game: gameName,
                    content_style: 'general'
                })
                .select()
                .single();
            seoProfile = newProfile;
        }

        // 3. Detect competition level for this game
        const { data: competitionData } = await supabase
            .rpc('detect_competition_level', { p_game_name: gameName });
        
        const competitionLevel = competitionData || 'medium';

        // 4. Generate optimized title
        const optimizedTitle = await generateOptimizedTitle(
            clipData, 
            gameName, 
            competitionLevel,
            seoProfile.content_style
        );

        // 5. Generate optimized description
        const optimizedDescription = await generateOptimizedDescription(
            clipData,
            gameName,
            competitionLevel
        );

        // 6. Generate hashtags dynamically
        const hashtags = await generateHashtags(gameName, competitionLevel, userId);

        // 7. Generate platform-specific captions
        const captions = {
            youtube: optimizedTitle,
            tiktok: generateTikTokCaption(clipData, gameName),
            shorts: generateShortsCaption(clipData, gameName)
        };

        // 8. Determine optimal posting time
        const optimalPostTime = await getOptimalPostTime(userId, gameName);

        // 9. Assign to playlists
        const playlists = assignToPlaylists(clipData, gameName);

        // 10. Store SEO data
        await supabase
            .from('clips')
            .update({
                viral_title: optimizedTitle,
                viral_description: optimizedDescription,
                hashtags: hashtags,
                optimal_post_time: optimalPostTime,
                playlist_ids: playlists,
                seo_optimized: true,
                game_name: gameName,
                competition_level: competitionLevel,
                seo_version: '2.0'
            })
            .eq('id', clipData.id);

        // 11. Track for learning
        await supabase
            .from('seo_performance')
            .insert({
                clip_id: clipData.id,
                user_id: userId,
                game_name: gameName,
                original_title: clipData.title,
                optimized_title: optimizedTitle,
                hashtags_used: hashtags,
                seo_strategy_used: competitionLevel === 'low' ? 'aggressive' : 
                                   competitionLevel === 'high' ? 'specific' : 'balanced'
            });

        return {
            success: true,
            seo: {
                title: optimizedTitle,
                description: optimizedDescription,
                hashtags: hashtags,
                captions: captions,
                postTime: optimalPostTime,
                playlists: playlists,
                competitionLevel: competitionLevel,
                gameName: gameName
            }
        };

    } catch (error) {
        console.error('Enhancement error:', error);
        // Return fallback SEO if anything fails
        return {
            success: false,
            error: error.message,
            seo: getFallbackSEO(clipData)
        };
    }
}

// Generate optimized title for ANY game
async function generateOptimizedTitle(clipData, gameName, competition, style) {
    try {
        // Get the best template for this content type
        const { data: template } = await supabase
            .from('universal_seo_templates')
            .select('*')
            .eq('content_type', detectContentType(clipData))
            .eq('is_active', true)
            .order('success_rate', { ascending: false })
            .limit(1)
            .single();

        if (!template) {
            return generateFallbackTitle(clipData, gameName);
        }

        // Select variant based on competition
        let titlePattern = template.title_pattern;
        if (competition === 'low' && template.low_competition_variant) {
            titlePattern = template.low_competition_variant;
        } else if (competition === 'high' && template.high_competition_variant) {
            titlePattern = template.high_competition_variant;
        }

        // Get game abbreviation
        const { data: abbrev } = await supabase
            .rpc('generate_game_abbreviation', { p_game_name: gameName });

        // Replace placeholders
        let title = titlePattern
            .replace(/{game}/g, gameName)
            .replace(/{gameAbbrev}/g, abbrev || gameName)
            .replace(/{achievement}/g, clipData.achievement || 'Epic Play')
            .replace(/{number}/g, Math.floor(Math.random() * 99) + 1)
            .replace(/{description}/g, clipData.highlight || '')
            .replace(/{mode}/g, clipData.mode || 'Match')
            .replace(/{action}/g, clipData.action || 'dominated');

        // Optimize length (60-70 chars for YouTube)
        if (title.length > 70) {
            title = title.substring(0, 67) + '...';
        }

        // A/B test tracking
        await supabase
            .from('universal_seo_templates')
            .update({ 
                times_used: template.times_used + 1 
            })
            .eq('id', template.id);

        return title;

    } catch (error) {
        console.error('Title generation error:', error);
        return generateFallbackTitle(clipData, gameName);
    }
}

// Generate optimized description
async function generateOptimizedDescription(clipData, gameName, competition) {
    try {
        const { data: template } = await supabase
            .from('universal_seo_templates')
            .select('description_pattern')
            .eq('content_type', detectContentType(clipData))
            .limit(1)
            .single();

        let description = template?.description_pattern || getDefaultDescription();

        // Replace placeholders
        description = description
            .replace(/{game}/g, gameName)
            .replace(/{action}/g, clipData.action || 'made an epic play')
            .replace(/{description}/g, clipData.context || '');

        // Add CTAs based on competition
        if (competition === 'low') {
            description += '\n\n🏆 BEST ' + gameName.toUpperCase() + ' CONTENT ON YOUTUBE!';
        } else if (competition === 'high') {
            description += '\n\n📚 Learning ' + gameName + ' and sharing my journey!';
        }

        // Add standard footer
        description += '\n\n🔔 Subscribe for daily ' + gameName + ' content!';
        description += '\n📺 Full streams on Twitch: [link]';
        description += '\n🎮 Discord: [link]';
        description += '\n\n#' + gameName.replace(/\s+/g, '') + ' #gaming #gameplay';

        return description;

    } catch (error) {
        return getDefaultDescription() + '\n\n#' + gameName + ' #gaming';
    }
}

// Generate hashtags for ANY game
async function generateHashtags(gameName, competition, userId) {
    try {
        // Check if we have cached hashtags for this game
        let { data: cached } = await supabase
            .from('dynamic_hashtags')
            .select('*')
            .eq('user_id', userId)
            .eq('game_name', gameName)
            .single();

        if (!cached || !cached.generated_hashtags) {
            // Generate new hashtags using database function
            const { data: generated } = await supabase
                .rpc('generate_game_hashtags', { 
                    p_game_name: gameName,
                    p_competition_level: competition 
                });

            // Cache them
            await supabase
                .from('dynamic_hashtags')
                .upsert({
                    user_id: userId,
                    game_name: gameName,
                    generated_hashtags: generated,
                    last_rotation_index: 0
                });

            cached = { generated_hashtags: generated, last_rotation_index: 0 };
        }

        // Mix hashtags based on optimal distribution
        const hashtags = [];
        const distribution = {
            mega: 1,    // 1 huge hashtag for reach
            large: 2,   // 2 game-specific popular
            medium: 3,  // 3 medium competition
            niche: 3,   // 3 targeted hashtags
            micro: 1    // 1 very specific
        };

        // Rotate through hashtags to avoid repetition
        for (const [tier, count] of Object.entries(distribution)) {
            const tierHashtags = cached.generated_hashtags[tier] || [];
            const startIdx = (cached.last_rotation_index || 0) % tierHashtags.length;
            
            for (let i = 0; i < Math.min(count, tierHashtags.length); i++) {
                const idx = (startIdx + i) % tierHashtags.length;
                if (tierHashtags[idx]) {
                    hashtags.push(tierHashtags[idx]);
                }
            }
        }

        // Update rotation index
        await supabase
            .from('dynamic_hashtags')
            .update({ 
                last_rotation_index: (cached.last_rotation_index || 0) + 1 
            })
            .eq('user_id', userId)
            .eq('game_name', gameName);

        return hashtags;

    } catch (error) {
        console.error('Hashtag generation error:', error);
        // Fallback hashtags
        return ['#gaming', '#' + gameName.replace(/\s+/g, ''), '#gameplay', '#gamer'];
    }
}

// TikTok-specific caption
function generateTikTokCaption(clipData, gameName) {
    const hooks = [
        'Wait for it...',
        'POV: You\'re actually good at ' + gameName,
        'Did I just...? 😱',
        'Rate this play 1-10',
        'Nobody: \nMe in ' + gameName + ':',
        'Tell me this isn\'t lucky',
        gameName + ' hits different at 3am',
        'Why is nobody talking about this?'
    ];

    const hook = hooks[Math.floor(Math.random() * hooks.length)];
    return hook + ' #' + gameName.replace(/\s+/g, '').toLowerCase() + ' #fyp #gaming';
}

// YouTube Shorts caption
function generateShortsCaption(clipData, gameName) {
    return clipData.highlight || 'Insane ' + gameName + ' moment!';
}

// Assign to playlists automatically
function assignToPlaylists(clipData, gameName) {
    const playlists = [];
    
    // Always add to game-specific playlist
    playlists.push(gameName + ' Highlights');
    
    // Add based on performance
    if (clipData.ai_score > 0.7) {
        playlists.push('🔥 Viral Clips');
    }
    if (clipData.ai_score > 0.5) {
        playlists.push('Best Moments');
    }
    
    // Add based on content type
    const contentType = detectContentType(clipData);
    if (contentType === 'win') playlists.push('Victory Compilation');
    if (contentType === 'fail') playlists.push('Funny Fails');
    if (contentType === 'tutorial') playlists.push('Tips & Guides');
    
    // Weekly playlist
    const weekNum = Math.floor((Date.now() - new Date('2025-01-01').getTime()) / (7 * 24 * 60 * 60 * 1000));
    playlists.push('Week ' + weekNum + ' Highlights');
    
    return playlists;
}

// Get optimal posting time
async function getOptimalPostTime(userId, gameName) {
    try {
        // Get user's schedule
        const { data: schedule } = await supabase
            .from('optimal_posting_schedule')
            .select('*')
            .eq('user_id', userId)
            .eq('platform', 'youtube')
            .single();

        if (!schedule) {
            // Default times if no schedule exists
            return getNextDefaultTime();
        }

        // Check if we have game-specific times
        const gameSpecificTimes = schedule.game_specific_times?.[gameName];
        if (gameSpecificTimes?.length > 0) {
            return getNextTimeSlot(gameSpecificTimes, schedule.timezone);
        }

        // Use general optimal times
        const now = new Date();
        const isWeekend = [0, 6].includes(now.getDay());
        const slots = isWeekend ? schedule.weekend_slots : schedule.weekday_slots;
        
        return getNextTimeSlot(slots, schedule.timezone);

    } catch (error) {
        return getNextDefaultTime();
    }
}

// Helper: Get next available time slot
function getNextTimeSlot(slots, timezone = 'America/Chicago') {
    const now = new Date();
    const currentHour = now.getHours();
    
    // Find next slot
    let nextSlot = slots.find(slot => slot > currentHour);
    
    if (!nextSlot) {
        // No more slots today, use tomorrow's first slot
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(slots[0], 0, 0, 0);
        return tomorrow.toISOString();
    }
    
    // Use today's next slot
    const nextTime = new Date(now);
    nextTime.setHours(nextSlot, Math.floor(Math.random() * 60), 0, 0);
    return nextTime.toISOString();
}

// Helper: Detect content type from clip
function detectContentType(clipData) {
    const title = (clipData.title || '').toLowerCase();
    const description = (clipData.description || '').toLowerCase();
    const combined = title + ' ' + description;
    
    if (combined.includes('win') || combined.includes('victory')) return 'win';
    if (combined.includes('kill') || combined.includes('elim')) return 'kill';
    if (combined.includes('fail') || combined.includes('funny')) return 'fail';
    if (combined.includes('how to') || combined.includes('guide')) return 'tutorial';
    if (combined.includes('secret') || combined.includes('found')) return 'discovery';
    if (combined.includes('clutch') || combined.includes('1v')) return 'clutch';
    
    return 'highlight'; // default
}

// Fallback title generation
function generateFallbackTitle(clipData, gameName) {
    const templates = [
        `${gameName} - ${clipData.title || 'Epic Moment'}`,
        `INSANE ${gameName} Clip - Must See!`,
        `${gameName} Gameplay - ${clipData.highlight || 'Incredible Play'}`,
        `You Won't Believe This ${gameName} Moment`
    ];
    
    return templates[Math.floor(Math.random() * templates.length)];
}

// Default description
function getDefaultDescription() {
    return 'Epic gaming moment! Watch this incredible play and let me know what you think in the comments!';
}

// Get next default time (fallback)
function getNextDefaultTime() {
    const now = new Date();
    now.setHours(now.getHours() + 4, 0, 0, 0); // Post in 4 hours
    return now.toISOString();
}

// Complete fallback SEO
function getFallbackSEO(clipData = {}) {
    const gameName = clipData.game || 'Gaming';
    return {
        title: generateFallbackTitle(clipData, gameName),
        description: getDefaultDescription(),
        hashtags: ['#gaming', '#gamer', '#gameplay', '#videogames'],
        captions: {
            youtube: 'Check out this clip!',
            tiktok: 'Wait for it... #gaming #fyp'
        },
        postTime: getNextDefaultTime(),
        playlists: ['Gaming Highlights']
    };
}

// Performance analysis function
async function analyzePerformance(clipData, userId) {
    // Implementation for tracking what's working
    // This runs after clips have been live for a while
    return { analyzed: true };
}

// Learning function
async function learnFromResults(clipData, userId) {
    // Implementation for learning from results
    // Updates templates and strategies based on performance
    return { learned: true };
}