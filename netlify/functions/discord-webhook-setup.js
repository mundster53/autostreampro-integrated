// netlify/functions/discord-webhook-setup.js
const { createClient } = require('@supabase/supabase-js');

// CORS headers for browser requests
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

    // Only accept POST requests
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
        const { userId, webhookUrl, testMode = false } = JSON.parse(event.body);

        // Validate webhook URL format
        if (!webhookUrl || !webhookUrl.includes('discord.com/api/webhooks/')) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Invalid Discord webhook URL. It should look like: https://discord.com/api/webhooks/...' 
                })
            };
        }

        // Test the webhook if requested
        if (testMode) {
            const testEmbed = {
                embeds: [{
                    title: "✅ AutoStreamPro Connected!",
                    description: "Your Discord webhook is working perfectly. Stream announcements will be posted here.",
                    color: 5763719, // Green
                    timestamp: new Date(),
                    footer: {
                        text: "AutoStreamPro Stream Announcements"
                    }
                }]
            };

            const testResponse = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(testEmbed)
            });

            if (!testResponse.ok) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ 
                        error: 'Webhook test failed. Please check your webhook URL.' 
                    })
                };
            }
        }

        // Check if Discord connection exists
        const { data: existingConnection } = await supabase
            .from('streaming_connections')
            .select('*')
            .eq('user_id', userId)
            .eq('platform', 'discord')
            .single();

        if (existingConnection) {
            // Update existing connection
            const { error: updateError } = await supabase
                .from('streaming_connections')
                .update({ 
                    webhook_url: webhookUrl,
                    announcement_enabled: true,
                    updated_at: new Date()
                })
                .eq('user_id', userId)
                .eq('platform', 'discord');

            if (updateError) throw updateError;
        } else {
            // Create new Discord connection
            const { error: insertError } = await supabase
                .from('streaming_connections')
                .insert({
                    user_id: userId,
                    platform: 'discord',
                    webhook_url: webhookUrl,
                    announcement_enabled: true,
                    is_active: true,
                    created_at: new Date()
                });

            if (insertError) throw insertError;
        }

        // Log the setup
        await supabase
            .from('user_activity_logs')
            .insert({
                user_id: userId,
                action: 'discord_webhook_setup',
                metadata: { webhook_configured: true },
                created_at: new Date()
            });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                success: true,
                message: 'Discord webhook configured successfully'
            })
        };

    } catch (error) {
        console.error('Discord webhook setup error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to configure Discord webhook',
                details: error.message
            })
        };
    }
};