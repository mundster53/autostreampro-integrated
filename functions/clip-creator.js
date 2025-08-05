// CLIP CREATOR SERVICE - DO NOT MODIFY WITHOUT PERMISSION
// Status: PRODUCTION
// Purpose: Automatically create Twitch clips during streams

const TokenRefresher = require('./token-refresher');

const fetch = require('node-fetch');

class ClipCreator {
    constructor(supabase) {
        this.supabase = supabase;
	this.tokenRefresher = new TokenRefresher(supabase);
    }

    async createClipForStream(userId, streamerId, streamId) {
    try {
        // Get user's Twitch token AND refresh token
        const { data: connection } = await this.supabase
            .from('streaming_connections')
            .select('access_token, refresh_token')  // ADD refresh_token here
            .eq('user_id', userId)
            .eq('platform', 'twitch')
            .single();
            
        if (!connection || !connection.access_token) {
            console.error('[ClipCreator] No Twitch token for user:', userId);
            return null;
        }
        
        // Create a clip using user's token
        let response = await fetch('https://api.twitch.tv/helix/clips', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${connection.access_token}`,
                'Client-Id': process.env.TWITCH_CLIENT_ID,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                broadcaster_id: streamerId,
                has_delay: false
            })
        });
        
        // ADD TOKEN REFRESH HERE - Check if token expired
        if (response.status === 401 && connection.refresh_token) {
            console.log('[ClipCreator] Token expired, refreshing...');
            
            // Refresh the token
            const refreshResponse = await fetch('https://id.twitch.tv/oauth2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: connection.refresh_token,
                    client_id: process.env.TWITCH_CLIENT_ID,
                    client_secret: process.env.TWITCH_CLIENT_SECRET
                })
            });

            const newTokens = await refreshResponse.json();
            
            if (newTokens.access_token) {
                // Update tokens in database
                await this.supabase
                    .from('streaming_connections')
                    .update({
                        access_token: newTokens.access_token,
                        refresh_token: newTokens.refresh_token || connection.refresh_token,
                        updated_at: new Date()
                    })
                    .eq('user_id', userId)
                    .eq('platform', 'twitch');
                
                console.log('[ClipCreator] Token refreshed successfully');
                
                // Retry with new token
                response = await fetch('https://api.twitch.tv/helix/clips', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${newTokens.access_token}`,
                        'Client-Id': process.env.TWITCH_CLIENT_ID,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        broadcaster_id: streamerId,
                        has_delay: false
                    })
                });
            }
        }
        
        if (!response.ok) {
            const error = await response.text();
            console.error('[ClipCreator] Clip creation failed:', error);
            return null;
        }
        
        const data = await response.json();
        console.log('[ClipCreator] Created clip:', data.data[0].id);
        
        // Wait 15 seconds for clip to process
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        // Get clip details
        return await this.getClipDetails(data.data[0].id, connection.access_token);
        
    } catch (error) {
        console.error('[ClipCreator] Error creating clip:', error);
        return null;
    }
}

    async getClipDetails(clipId, accessToken) {
        try {
            const response = await fetch(`https://api.twitch.tv/helix/clips?id=${clipId}`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Client-Id': process.env.TWITCH_CLIENT_ID
                }
            });

            const data = await response.json();
            return data.data[0];
            
        } catch (error) {
            console.error('[ClipCreator] Error getting clip details:', error);
            return null;
        }
    }
}

module.exports = ClipCreator;
