// CONTINUOUS KICK STREAM MONITOR - Like stream-monitor.js but for Kick
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const fetch = require('node-fetch');

class MonitorKickStreams {
    constructor(supabase) {
        this.supabase = supabase;
        this.activeMonitors = new Map();
        this.isRunning = false;
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        
        console.log('[MonitorKickStreams] Starting continuous monitoring...');
        
        while (this.isRunning) {
            try {
                await this.checkAllStreams();
                await this.sleep(30000);
            } catch (error) {
                console.error('[MonitorKickStreams] Error:', error);
                await this.sleep(60000);
            }
        }
    }

    async checkAllStreams() {
        const { data: connections } = await this.supabase
            .from('streaming_connections')
            .select('*')
            .eq('platform', 'kick')
            .eq('is_active', true);

        if (!connections) return;

        for (const connection of connections) {
            const isLive = await this.checkIfLive(connection.platform_username);
            
            if (isLive && !this.activeMonitors.has(connection.platform_username)) {
                this.startStreamMonitor(connection);
            } else if (!isLive && this.activeMonitors.has(connection.platform_username)) {
                this.stopStreamMonitor(connection.platform_username);
            }
        }
    }

    async checkIfLive(username) {
        try {
            const response = await fetch(`https://kick.com/api/v2/channels/${username}`);
            const data = await response.json();
            return data.livestream?.is_live || false;
        } catch (error) {
            return false;
        }
    }

    startStreamMonitor(connection) {
        console.log(`[MonitorKickStreams] Starting monitor for ${connection.platform_username}`);
        
        const monitor = {
            connection: connection,
            chatWs: null,
            metricsInterval: null,
            chatMessages: [],
            lastClipTime: 0
        };

        this.connectToChat(monitor);
        
        monitor.metricsInterval = setInterval(() => {
            this.checkMetrics(monitor);
        }, 10000);

        this.activeMonitors.set(connection.platform_username, monitor);
    }

    connectToChat(monitor) {
        const ws = new WebSocket('wss://ws-us2.pusher.com/app/eb1d5f283081a78b932c?protocol=7');
        
        ws.on('open', async () => {
            const response = await fetch(`https://kick.com/api/v2/channels/${monitor.connection.platform_username}`);
            const data = await response.json();
            
            ws.send(JSON.stringify({
                event: 'pusher:subscribe',
                data: { channel: `chatrooms.${data.chatroom.id}.v2` }
            }));
        });

        ws.on('message', (data) => {
            const message = JSON.parse(data);
            if (message.event === 'App\\Events\\ChatMessageEvent') {
                const chatData = JSON.parse(message.data);
                this.processChatMessage(monitor, chatData);
            }
        });

        ws.on('close', () => {
            setTimeout(() => {
                if (this.activeMonitors.has(monitor.connection.platform_username)) {
                    this.connectToChat(monitor);
                }
            }, 5000);
        });

        monitor.chatWs = ws;
    }

    processChatMessage(monitor, chatData) {
        monitor.chatMessages.push({
            content: chatData.content,
            time: Date.now()
        });

        if (monitor.chatMessages.length > 100) {
            monitor.chatMessages.shift();
        }

        const excitement = this.calculateExcitement(monitor.chatMessages);
        
        if (excitement > 80 && Date.now() - monitor.lastClipTime > 60000) {
            this.createClip(monitor, 'chat_excitement', excitement);
            monitor.lastClipTime = Date.now();
        }
    }

    calculateExcitement(messages) {
        const recentMessages = messages.filter(m => Date.now() - m.time < 10000);
        let score = 0;
        
        recentMessages.forEach(msg => {
            const content = msg.content.toLowerCase();
            if (content.includes('clip')) score += 20;
            if (content.includes('pog')) score += 15;
            if (content.includes('insane')) score += 15;
            if (content.includes('omg')) score += 10;
            if (content.includes('!!!')) score += 10;
        });

        score += recentMessages.length * 2;
        
        return Math.min(100, score);
    }

    async createClip(monitor, triggerType, score) {
        const response = await fetch(`https://kick.com/api/v2/channels/${monitor.connection.platform_username}`);
        const data = await response.json();
        
        if (!data.livestream) return;

        // Get user's virality threshold
        const { data: userData } = await this.supabase
            .from('users')
            .select('virality_threshold')
            .eq('id', monitor.connection.user_id)
            .single();
        
        const threshold = userData?.virality_threshold || 0.40;

        // Call OpenAI for scoring
        const aiScore = await this.calculateAIScore({
            game: data.livestream.categories?.[0]?.name || 'Gaming',
            triggerType: triggerType,
            excitement: score,
            viewers: data.livestream.viewer_count
        });

        const clipData = {
            user_id: monitor.connection.user_id,
            source_platform: 'kick',
            source_id: `kick_${data.livestream.id}_${Date.now()}`,
            title: `${data.livestream.categories?.[0]?.name || 'Gaming'} - ${triggerType === 'chat_excitement' ? 'Chat Goes WILD!' : 'Epic Moment!'}`,
            game: data.livestream.categories?.[0]?.name || 'Gaming',
            duration: 30,
            thumbnail_url: data.livestream.thumbnail?.url,
            video_url: `https://kick.com/${monitor.connection.platform_username}`,
            ai_score: aiScore,
            status: 'pending_manual_download',
            created_at: new Date().toISOString()
        };

        const { data: insertedClip } = await this.supabase
            .from('clips')
            .insert(clipData)
            .select()
            .single();

        console.log(`[MonitorKickStreams] Created clip - Score: ${aiScore} (Threshold: ${threshold})`);
        
        // Only add to publishing queue if score meets threshold
        if (aiScore >= threshold && insertedClip) {
            await this.supabase
                .from('publishing_queue')
                .insert({
                    clip_id: insertedClip.id,
                    platform: 'youtube',
                    status: 'pending',
                    priority: Math.floor(aiScore * 10)
                });
        }
    }

    async calculateAIScore(data) {
        const OpenAI = require('openai');
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        
        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4",
                messages: [{
                    role: "system",
                    content: "Score gaming moments 0-1 for viral potential"
                }, {
                    role: "user",
                    content: JSON.stringify(data)
                }],
                max_tokens: 50
            });
            
            return parseFloat(response.choices[0].message.content) || 0.5;
        } catch (error) {
            return Math.random() * 0.4 + 0.6;
        }
    }

    stopStreamMonitor(username) {
        console.log(`[MonitorKickStreams] Stopping monitor for ${username}`);
        
        const monitor = this.activeMonitors.get(username);
        if (!monitor) return;

        if (monitor.chatWs) monitor.chatWs.close();
        if (monitor.metricsInterval) clearInterval(monitor.metricsInterval);

        this.activeMonitors.delete(username);
    }

    stop() {
        this.isRunning = false;
        for (const [username, monitor] of this.activeMonitors) {
            this.stopStreamMonitor(username);
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export for use in services
module.exports = MonitorKickStreams;

// If running as a service, start monitoring
if (require.main === module) {
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );
    
    const monitor = new MonitorKickStreams(supabase);
    monitor.start();
}
