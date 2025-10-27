// netlify/functions/discord-announce-stream.js
const { createClient } = require('@supabase/supabase-js');

// CORS headers
const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );

    try {
        const { 
            userId, 
            streamTitle, 
            game, 
            platform, 
            streamUrl, 
            scheduledTime,
            announcementType = 'going_live' // 'scheduled' or 'going_live'
        } = JSON.parse(event.body);

        // Get user's Discord webhook
        const { data: connection, error: connError } = await supabase
            .from('streaming_connections')
            .select('webhook_url, announcement_enabled')
            .eq('user_id', userId)
            .eq('platform', 'discord')
            .single();

        if (connError || !connection || !connection.webhook_url) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    error: 'Discord webhook not configured',
                    setupRequired: true
                })
            };
        }

        if (!connection.announcement_enabled) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ 
                    message: 'Discord announcements are disabled for this user'
                })
            };
        }

        // Get user profile for additional info
        const { data: profile } = await supabase
            .from('user_profiles')
            .select('display_name, avatar_url, twitch_channel_url, youtube_channel_url, kick_channel_url')
            .eq('user_id', userId)
            .single();

        // Determine the correct stream URL based on platform
        let finalStreamUrl = streamUrl;
        if (!streamUrl) {
            switch(platform?.toLowerCase()) {
                case 'twitch':
                    finalStreamUrl = profile?.twitch_channel_url || 'https://twitch.tv';
                    break;
                case 'youtube':
                    finalStreamUrl = profile?.youtube_channel_url || 'https://youtube.com';
                    break;
                case 'kick':
                    finalStreamUrl = profile?.kick_channel_url || 'https://kick.com';
                    break;
                default:
                    finalStreamUrl = 'https://www.autostreampro.com';
            }
        }

        // Create Discord embed based on announcement type
        let embed;
        if (announcementType === 'scheduled') {
            // Stream scheduled announcement
            const scheduleDate = new Date(scheduledTime);
            const timeString = scheduleDate.toLocaleString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZoneName: 'short'
            });

            embed = {
                embeds: [{
                    title: "📅 Stream Scheduled!",
                    description: `**${streamTitle || 'New Stream'}**`,
                    color: 5793266, // Blue
                    fields: [
                        {
                            name: "🎮 Game",
                            value: game || 'Gaming',
                            inline: true
                        },
                        {
                            name: "📺 Platform",
                            value: platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Streaming',
                            inline: true
                        },
                        {
                            name: "⏰ When",
                            value: timeString,
                            inline: false
                        }
                    ],
                    url: finalStreamUrl,
                    timestamp: new Date(),
                    footer: {
                        text: "Set a reminder! • AutoStreamPro",
                        icon_url: "https://www.autostreampro.com/favicon.ico"
                    },
                    author: profile?.display_name ? {
                        name: profile.display_name,
                        icon_url: profile.avatar_url
                    } : undefined
                }]
            };
        } else {
            // Going live announcement
            embed = {
                embeds: [{
                    title: "🔴 LIVE NOW!",
                    description: `**${streamTitle || 'Stream is Live!'}**\n\n[**Click here to watch!**](${finalStreamUrl})`,
                    color: 15158332, // Red
                    fields: [
                        {
                            name: "🎮 Playing",
                            value: game || 'Gaming',
                            inline: true
                        },
                        {
                            name: "📺 Streaming on",
                            value: platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Live',
                            inline: true
                        }
                    ],
                    url: finalStreamUrl,
                    image: {
                        url: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${profile?.display_name?.toLowerCase()}-320x180.jpg`
                    },
                    timestamp: new Date(),
                    footer: {
                        text: "Drop by and say hi! • AutoStreamPro",
                        icon_url: "https://www.autostreampro.com/favicon.ico"
                    },
                    author: profile?.display_name ? {
                        name: `${profile.display_name} is streaming!`,
                        icon_url: profile.avatar_url
                    } : undefined
                }]
            };
        }

        // Add @everyone ping if going live
        if (announcementType === 'going_live') {
            embed.content = "@everyone";
        }

        // Send to Discord
        const discordResponse = await fetch(connection.webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(embed)
        });

        if (!discordResponse.ok) {
            const errorText = await discordResponse.text();
            throw new Error(`Discord API error: ${discordResponse.status} - ${errorText}`);
        }

        // Log the announcement
        await supabase
            .from('stream_announcements')
            .insert({
                user_id: userId,
                stream_title: streamTitle,
                game: game,
                platforms_announced: ['discord'],
                announcement_type: announcementType,
                scheduled_time: scheduledTime,
                created_at: new Date()
            });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                success: true,
                message: `Discord ${announcementType} announcement sent successfully`
            })
        };

    } catch (error) {
        console.error('Discord announcement error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to send Discord announcement',
                details: error.message
            })
        };
    }
};