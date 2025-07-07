// STREAM MONITOR SERVICE - DO NOT MODIFY WITHOUT PERMISSION
// Status: DEVELOPMENT
// Purpose: Monitor Twitch streams and detect clips

const fetch = require('node-fetch');
const ClipCreator = require('../services/clip-creator');

class StreamMonitor {
    constructor(supabase) {
        this.supabase = supabase;
        this.twitchClientId = process.env.TWITCH_CLIENT_ID;
        this.twitchClientSecret = process.env.TWITCH_CLIENT_SECRET;
        this.appToken = null;
        this.tokenExpiry = null;
        this.clipCreator = new ClipCreator(supabase);
        this.lastClipTime = {};
    }

    async getAppToken() {
        // Cache token if still valid
        if (this.appToken && this.tokenExpiry > Date.now()) {
            return this.appToken;
        }

        const response = await fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: this.twitchClientId,
                client_secret: this.twitchClientSecret,
                grant_type: 'client_credentials'
            })
        });

        const data = await response.json();
        this.appToken = data.access_token;
        this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Refresh 1 min early
        
        return this.appToken;
    }

    async checkAllStreams() {
        try {
            // Get all active Twitch connections
            const { data: connections, error } = await this.supabase
                .from('streaming_connections')
                .select('user_id, platform_user_id')
                .eq('platform', 'twitch')
                .eq('is_active', true);

            if (error) throw error;

            console.log(`[StreamMonitor] Checking ${connections.length} Twitch connections`);

            // Check each user's stream
            for (const connection of connections) {
                await this.checkUserStream(connection);
            }

        } catch (error) {
            console.error('[StreamMonitor] Error:', error);
        }
    }

    async checkUserStream(connection) {
        try {
            const token = await this.getAppToken();
            
            // Check if stream is live
            const response = await fetch(
                `https://api.twitch.tv/helix/streams?user_id=${connection.platform_user_id}`,
                {
                    headers: {
                        'Client-ID': this.twitchClientId,
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            const data = await response.json();

// If we get 401, try to refresh user's token
        if (response.status === 401 && connection.refresh_token) {
            console.log('[StreamMonitor] Access token expired, refreshing...');
            
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
                    .eq('user_id', connection.user_id)
                    .eq('platform', 'twitch');
                
                console.log('[StreamMonitor] Token refreshed successfully');
                
                // Update connection object for this run
                connection.access_token = newTokens.access_token;
                
                // Retry the stream check with new token
                return this.checkUserStream(connection);
            }
        }
            
            if (data.data && data.data.length > 0) {
                const stream = data.data[0];
                console.log(`[StreamMonitor] User ${connection.user_id} is LIVE - ${stream.game_name}`);
                
                // Create clips every 10 minutes
                const lastClip = this.lastClipTime[connection.user_id] || 0;
                const timeSinceLastClip = Date.now() - lastClip;
                
                if (timeSinceLastClip > 10 * 60 * 1000) { // 10 minutes
                    console.log('[StreamMonitor] Creating automatic clip...');
                    
                    const clip = await this.clipCreator.createClipForStream(
                        connection.user_id,
                        connection.platform_user_id,
                        stream.id
                    );
                    
                    if (clip) {
                        await this.saveClip(connection.user_id, clip);
                        this.lastClipTime[connection.user_id] = Date.now();
                    }
                }
                
                // Also check for manual clips
                await this.checkForClips(connection.user_id, connection.platform_user_id);
            }

        } catch (error) {
            console.error(`[StreamMonitor] Error checking user ${connection.user_id}:`, error);
        }
    }

    async checkForClips(userId, twitchUserId) {
        try {
            const token = await this.getAppToken();
            
            // Get clips from last hour
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
            
            const response = await fetch(
                `https://api.twitch.tv/helix/clips?broadcaster_id=${twitchUserId}&started_at=${oneHourAgo}&first=10`,
                {
                    headers: {
                        'Client-ID': this.twitchClientId,
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            const data = await response.json();
            
            if (data.data && data.data.length > 0) {
                console.log(`[StreamMonitor] Found ${data.data.length} clips for user ${userId}`);
                
                // Save new clips to database
                for (const clip of data.data) {
                    await this.saveClip(userId, clip);
                }
            }

        } catch (error) {
            console.error(`[StreamMonitor] Error checking clips:`, error);
        }
    }

    async saveClip(userId, twitchClip) {
        try {
            // Check if clip already exists
            const { data: existing } = await this.supabase
                .from('clips')
                .select('id')
                .eq('source_id', twitchClip.id)
                .single();

            if (existing) return; // Already processed

            // Save new clip
            const { data, error } = await this.supabase
                .from('clips')
                .insert({
                    user_id: userId,
                    source_platform: 'twitch',
                    source_id: twitchClip.id,
                    title: twitchClip.title,
                    game: twitchClip.game_id,
                    duration: twitchClip.duration,
                    thumbnail_url: twitchClip.thumbnail_url,
                    video_url: twitchClip.thumbnail_url.replace('-preview-480x272.jpg', '.mp4'),
                    status: 'pending',
                    created_at: twitchClip.created_at
                });

            if (error) throw error;

            console.log(`[StreamMonitor] Saved clip: ${twitchClip.title}`);

        } catch (error) {
            console.error('[StreamMonitor] Error saving clip:', error);
        }
    }
}

module.exports = StreamMonitor;
