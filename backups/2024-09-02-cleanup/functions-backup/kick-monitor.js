// KICK MONITOR SERVICE - Continuous monitoring for Kick streams
const fetch = require('node-fetch');
const WebSocket = require('ws');

class KickMonitor {
    constructor(supabase) {
        this.supabase = supabase;
        this.activeMonitors = new Map();
    }

    async checkAllStreams() {
        try {
            const { data: connections } = await this.supabase
                .from('streaming_connections')
                .select('*')
                .eq('platform', 'kick')
                .eq('is_active', true);

            if (!connections) return;

            console.log(`[KickMonitor] Checking ${connections.length} Kick connections`);

            for (const connection of connections) {
                await this.checkStream(connection);
            }
        } catch (error) {
            console.error('[KickMonitor] Error:', error);
        }
    }

    async checkStream(connection) {
        const response = await fetch(`https://kick.com/api/v2/channels/${connection.platform_username}`);
        const data = await response.json();

        if (data.livestream?.is_live) {
            console.log(`[KickMonitor] ${connection.platform_username} is LIVE`);
            
            if (!this.activeMonitors.has(connection.platform_username)) {
                this.startMonitoring(connection, data);
            }
        } else {
            this.stopMonitoring(connection.platform_username);
        }
    }

    startMonitoring(connection, channelData) {
        console.log(`[KickMonitor] Starting monitor for ${connection.platform_username}`);
        
        const monitor = {
            connection: connection,
            streamData: channelData.livestream,
            chatMessages: [],
            lastClipTime: 0
        };

        // Connect to chat
        const ws = new WebSocket('wss://ws-us2.pusher.com/app/eb1d5f283081a78b932c?protocol=7');
        
        ws.on('open', () => {
            ws.send(JSON.stringify({
                event: 'pusher:subscribe',
                data: { channel: `chatrooms.${channelData.chatroom.id}.v2` }
            }));
        });

        ws.on('message', (data) => {
            const message = JSON.parse(data);
            if (message.event === 'App\\Events\\ChatMessageEvent') {
                this.processChatMessage(monitor, JSON.parse(message.data));
            }
        });

        monitor.ws = ws;
        this.activeMonitors.set(connection.platform_username, monitor);
    }

    async processChatMessage(monitor, chatData) {
        monitor.chatMessages.push({
            content: chatData.content,
            time: Date.now()
        });

        // Keep only last 100 messages
        if (monitor.chatMessages.length > 100) {
            monitor.chatMessages.shift();
        }

        // Check excitement
        const excitement = this.calculateExcitement(monitor.chatMessages);
        
        if (excitement > 80 && Date.now() - monitor.lastClipTime > 120000) {
            await this.createClip(monitor, excitement);
            monitor.lastClipTime = Date.now();
        }
    }

    calculateExcitement(messages) {
        const recent = messages.filter(m => Date.now() - m.time < 10000);
        let score = 0;
        
        recent.forEach(msg => {
            const content = msg.content.toLowerCase();
            if (content.includes('clip')) score += 20;
            if (content.includes('pog')) score += 15;
            if (content.includes('insane')) score += 15;
        });
        
        return Math.min(100, score + recent.length * 2);
    }

    async createClip(monitor, excitement) {
        // Get user's threshold
        const { data: userData } = await this.supabase
            .from('users')
            .select('virality_threshold')
            .eq('id', monitor.connection.user_id)
            .single();
        
        const threshold = userData?.virality_threshold || 0.40;
        
        // Score with AI
        const aiScore = Math.random() * 0.4 + 0.6; // Replace with real AI scoring
        
        const clipData = {
            user_id: monitor.connection.user_id,
            source_platform: 'kick',
            source_id: `kick_${monitor.streamData.id}_${Date.now()}`,
            title: `${monitor.streamData.categories?.[0]?.name || 'Gaming'} - Chat Goes WILD!`,
            game: monitor.streamData.categories?.[0]?.name || 'Gaming',
            duration: 30,
            thumbnail_url: monitor.streamData.thumbnail?.url,
            video_url: `https://kick.com/${monitor.connection.platform_username}`,
            ai_score: aiScore,
            status: 'pending_manual_download',
            created_at: new Date().toISOString()
        };

        await this.supabase.from('clips').insert(clipData);
        console.log(`[KickMonitor] Created clip - Score: ${aiScore} (Threshold: ${threshold})`);
    }

    stopMonitoring(username) {
        const monitor = this.activeMonitors.get(username);
        if (monitor) {
            if (monitor.ws) monitor.ws.close();
            this.activeMonitors.delete(username);
            console.log(`[KickMonitor] Stopped monitoring ${username}`);
        }
    }
}

module.exports = KickMonitor;
