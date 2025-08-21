// STREAM MONITOR SERVICE - DO NOT MODIFY WITHOUT PERMISSION
// Status: DEVELOPMENT
// Purpose: Monitor Twitch streams and detect clips

const fetch = require('node-fetch');
// const ClipCreator = require('../services/clip-creator');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

class StreamMonitor {
    constructor(supabase) {
        this.supabase = supabase;
        this.twitchClientId = process.env.TWITCH_CLIENT_ID;
        this.twitchClientSecret = process.env.TWITCH_CLIENT_SECRET;
        this.appToken = null;
        this.tokenExpiry = null;
        this.clipCreator = new ClipCreator(supabase);
        this.lastClipTime = {};
        
        // Initialize R2 client
        this.r2 = new S3Client({
            region: 'auto',
            endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: process.env.R2_ACCESS_KEY_ID,
                secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
            }
        });
    }

    async downloadToTempStorage(twitchClip) {
        try {
            // Get Twitch MP4 URL
            const mp4Url = await this.getTwitchDownloadUrl(twitchClip);
            
            // Download clip
            const response = await fetch(mp4Url);
            const buffer = await response.buffer();
            
            // Upload to R2
            const key = `clips/${twitchClip.id}.mp4`;
            await this.r2.send(new PutObjectCommand({
                Bucket: 'autostreampro-temp-clips',
                Key: key,
                Body: buffer,
                ContentType: 'video/mp4',
                Metadata: {
                    'twitch-id': twitchClip.id,
                    'auto-delete': '1d'
                }
            }));
            
            // Return R2 URL
            return `https://temp-clips.autostreampro.com/${key}`;
            
        } catch (error) {
            console.error('[StreamMonitor] Failed to store clip:', error);
            return null;
        }
    }

    async getTwitchDownloadUrl(twitchClip) {
        // Simple approach - extract from thumbnail
        if (twitchClip.thumbnail_url) {
            return twitchClip.thumbnail_url.replace('-preview-480x272.jpg', '.mp4');
        }
        throw new Error('Cannot determine MP4 URL');
    }

    async deleteFromTempStorage(clipId) {
        try {
            await this.r2.send(new DeleteObjectCommand({
                Bucket: 'autostreampro-temp-clips',
                Key: `clips/${clipId}.mp4`
            }));
        } catch (error) {
            console.error('[StreamMonitor] Failed to delete temp clip:', error);
        }
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
        console.log('[StreamMonitor] DISABLED - Using Railway version');
    return;
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

    // NEW: Continuous monitoring with retroactive clipping
    async startContinuousMonitoring(connection, streamData) {
        const streamerId = connection.platform_user_id;
        const userId = connection.user_id;
        
        console.log(`[ContinuousMonitor] Starting for ${streamerId}`);
        
        // Initialize monitoring data
        if (!this.activeMonitors) {
            this.activeMonitors = new Map();
        }
        
        const monitor = {
            streamerId,
            userId,
            streamId: streamData.id,
            startTime: Date.now(),
            lastClipTime: 0,
            checkInterval: null
        };
        
        // Check every second for viral moments
        monitor.checkInterval = setInterval(async () => {
            await this.checkForViralMoment(monitor);
        }, 1000); // EVERY SECOND!
        
        this.activeMonitors.set(streamerId, monitor);
    }

    // Check if something viral just happened
    async checkForViralMoment(monitor) {
        const now = Date.now();
        const streamDuration = (now - monitor.startTime) / 1000 / 60; // minutes
        
        // Skip first 5 minutes (ads)
        if (streamDuration < 5) return;
        
        // Minimum 2 minutes between clips
        if (now - monitor.lastClipTime < 120000) return;
        
        // In the future, add viral detection here:
        // - Audio spike detection
        // - Chat explosion detection  
        // - Visual change detection
        
        // For now, create clips at smart intervals
        if (streamDuration % 2 < 0.1) { // Every 2 minutes
            console.log(`[ContinuousMonitor] Creating retroactive clip!`);
            await this.createRetroactiveClip(monitor);
        }
    }

    // Create a clip of what JUST HAPPENED
    async createRetroactiveClip(monitor) {
        try {
            console.log(`[ContinuousMonitor] Capturing the LAST 30-60 seconds...`);
            
            // When you create a Twitch clip NOW, it captures the PAST!
            const clip = await this.clipCreator.createClipForStream(
                monitor.userId,
                monitor.streamerId,
                monitor.streamId
            );
            
            if (clip) {
                console.log(`[ContinuousMonitor] ✅ Captured viral moment from the past!`);
                await this.saveClip(monitor.userId, clip);
                monitor.lastClipTime = Date.now();
            }
        } catch (error) {
            console.error('[ContinuousMonitor] Error creating retroactive clip:', error);
        }
    }

    // Stop monitoring when stream ends
    stopContinuousMonitoring(streamerId) {
        const monitor = this.activeMonitors?.get(streamerId);
        if (monitor && monitor.checkInterval) {
            clearInterval(monitor.checkInterval);
            this.activeMonitors.delete(streamerId);
            console.log(`[ContinuousMonitor] Stopped monitoring ${streamerId}`);
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

            if (data.data && data.data.length > 0) {
                // Stream is LIVE!
                const streamData = data.data[0];
                console.log(`[StreamMonitor] ${streamData.user_name} is live playing ${streamData.game_name}`);
                
                // START CONTINUOUS MONITORING IF NOT ALREADY MONITORING
                if (!this.activeMonitors?.has(connection.platform_user_id)) {
                    await this.startContinuousMonitoring(connection, streamData);
                }
                
                // Also check for manual clips
                await this.checkForClips(connection.user_id, connection.platform_user_id);
            } else {
                // Stream is OFFLINE
                console.log(`[StreamMonitor] User ${connection.platform_user_id} is offline`);
                
                // STOP monitoring if it was running
                this.stopContinuousMonitoring(connection.platform_user_id);
            }

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

    async saveClip(userId, twitchClip) {  // FIXED: Removed semicolon, fixed syntax
        try {
            // Check if clip already exists
            const { data: existing } = await this.supabase
                .from('clips')
                .select('id')
                .eq('source_id', twitchClip.id)
                .single();
                
            if (existing) return; // Already processed
            
            // Download to S3 temporary storage
            console.log(`[StreamMonitor] Downloading clip to S3: ${twitchClip.id}`);
            let videoUrl = await this.downloadToTempStorage(twitchClip);
            
            if (!videoUrl) {
                videoUrl = twitchClip.thumbnail_url.replace('-preview-480x272.jpg', '.mp4');
                console.log('[StreamMonitor] S3 download failed, using thumbnail URL pattern');
            }
            
            // Save clip to database
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
                    video_url: videoUrl,
                    status: 'analyzing',
                    created_at: twitchClip.created_at
                })
                .select()
                .single();
                
            if (error) throw error;
            console.log(`[StreamMonitor] Saved clip: ${twitchClip.title}`);
            
            // IMMEDIATELY TRIGGER AI SCORING & VIRAL CONTENT GENERATION
            if (data && data.id) {
                console.log(`[StreamMonitor] Auto-scoring clip ${data.id}...`);
                
                try {
                    const scoreResponse = await fetch(`${process.env.NETLIFY_URL || 'https://beautiful-rugelach-bda4b4.netlify.app'}/.netlify/functions/analyzeClipContent`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ clipId: data.id })
                    });
                    
                    if (scoreResponse.ok) {
                        const result = await scoreResponse.json();
                        console.log(`[StreamMonitor] Clip scored: ${result.score}`);
                        
                        // If score is too low, delete from S3 immediately
                        if (result.score < 0.40) {
                            console.log(`[StreamMonitor] Low score (${result.score}), deleting from S3...`);
                            await this.deleteFromTempStorage(twitchClip.id);
                            
                            // Update database to reflect deletion
                            await this.supabase
                                .from('clips')
                                .update({ 
                                    status: 'rejected_low_score',
                                    video_url: `https://clips.twitch.tv/${twitchClip.id}` // Keep only Twitch URL
                                })
                                .eq('id', data.id);
                        } else {
                            // Good score - mark for upload
                            await this.supabase
                                .from('clips')
                                .update({ status: 'ready_for_upload' })
                                .eq('id', data.id);
                                
                            console.log(`[StreamMonitor] Clip ready for upload: ${result.score}`);
                        }
                    }
                } catch (scoreError) {
                    console.error('[StreamMonitor] Auto-scoring failed:', scoreError);
                    // Don't delete on error - retry later
                }
            }
            
        } catch (error) {
            console.error('[StreamMonitor] Error saving clip:', error);
        }
    }
}

module.exports = StreamMonitor;