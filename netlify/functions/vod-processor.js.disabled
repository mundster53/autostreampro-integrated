const AWS = require('aws-sdk');
const { createClient } = require('@supabase/supabase-js');
const YTDlpWrap = require('yt-dlp-wrap').default;
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Initialize services
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'us-east-1'
});

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const ytDlp = new YTDlpWrap();

// Clip length configurations for maximum impact
const CLIP_CONFIGS = {
    'ultra_short': { 
        duration: 7, 
        platforms: ['tiktok'], 
        scoreBoost: 1.3,
        description: 'Ultra-viral TikTok format'
    },
    'quick_moment': { 
        duration: 15, 
        platforms: ['tiktok', 'youtube'], 
        scoreBoost: 1.2,
        description: 'Quick kills, fails, reactions'
    },
    'standard_short': { 
        duration: 30, 
        platforms: ['tiktok', 'youtube'], 
        scoreBoost: 1.0,
        description: 'Complete plays, standard clips'
    },
    'extended_play': { 
        duration: 45, 
        platforms: ['youtube', 'tiktok'], 
        scoreBoost: 0.9,
        description: 'Full clutch moments, comebacks'
    },
    'max_short': { 
        duration: 59, 
        platforms: ['youtube'], 
        scoreBoost: 1.1,
        description: 'Maximum YouTube Shorts length'
    }
};

// Main handler
exports.handler = async (event, context) => {
    const { streamId, platform, userId, channelName } = JSON.parse(event.body);
    
    console.log(`Processing VOD for ${platform} stream ${streamId}`);
    
    try {
        // Step 1: Get VOD URL
        const vodUrl = await getVODUrl(platform, streamId, channelName);
        if (!vodUrl) {
            throw new Error(`VOD not available for ${platform} stream ${streamId}`);
        }
        
        // Step 2: Get VOD metadata
        const vodInfo = await getVODInfo(vodUrl);
        const duration = Math.min(vodInfo.duration || 14400, 21600); // Max 6 hours
        
        // Step 3: Analyze VOD for multiple moment types
        const moments = await analyzeVODForMoments(vodUrl, platform, duration, streamId, userId);
        
        // Step 4: Create variable-length clips from moments
        const clips = await createVariableLengthClips(vodUrl, moments, streamId, userId, platform);
        
        // Step 5: Queue for AI processing
        await queueClipsForProcessing(clips, userId);
        
        // Step 6: Log success metrics
        await logProcessingMetrics(userId, clips);
        
        return {
            statusCode: 200,
            body: JSON.stringify({ 
                success: true, 
                clipsCreated: clips.length,
                clipBreakdown: getClipBreakdown(clips),
                message: `Created ${clips.length} clips with optimized lengths`
            })
        };
        
    } catch (error) {
        console.error('VOD processing error:', error);
        
        await supabase.from('stream_events').insert({
            user_id: userId,
            platform,
            event_type: 'vod_error',
            metadata: { error: error.message, streamId }
        });
        
        return {
            statusCode: 200,
            body: JSON.stringify({ 
                success: false, 
                error: error.message 
            })
        };
    }
};

// Analyze VOD for different moment types
async function analyzeVODForMoments(vodUrl, platform, duration, streamId, userId) {
    const moments = [];
    const chunkDuration = 600; // 10 minutes
    const overlap = 120; // 2 minute overlap
    const step = chunkDuration - overlap;
    
    for (let start = 0; start < duration; start += step) {
        const end = Math.min(start + chunkDuration, duration);
        
        console.log(`Analyzing chunk: ${start}-${end} seconds`);
        
        try {
            const chunkFile = await downloadChunk(vodUrl, start, end);
            
            // Multi-factor analysis
            const audioMoments = await analyzeAudioIntensity(chunkFile, start);
            const sceneMoments = await analyzeSceneChanges(chunkFile, start);
            const combinedMoments = combineAndScoreMoments(audioMoments, sceneMoments);
            
            // Classify moments by ideal clip length
            const classifiedMoments = classifyMomentsByType(combinedMoments);
            
            // Deduplicate with existing moments
            const uniqueMoments = deduplicateMoments(moments, classifiedMoments);
            moments.push(...uniqueMoments);
            
            // Clean up immediately
            await fs.unlink(chunkFile);
            
        } catch (error) {
            console.error(`Error analyzing chunk ${start}-${end}:`, error);
        }
    }
    
    return moments;
}

// Advanced audio analysis for different intensity patterns
async function analyzeAudioIntensity(chunkFile, startOffset) {
    const moments = [];
    
    try {
        // Get detailed audio levels
        const audioAnalysis = execSync(
            `ffmpeg -i ${chunkFile} -af "astats=metadata=1:reset=1,ametadata=print:file=-" -f null - 2>/dev/null`,
            { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 }
        );
        
        const lines = audioAnalysis.split('\n');
        let currentIntensity = 0;
        let intensityStart = null;
        let peakIntensity = 0;
        let sustainedHighIntensity = 0;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (line.includes('lavfi.astats.Overall.Peak_level')) {
                const level = parseFloat(line.split('=')[1]);
                const timestamp = startOffset + (i * 0.5); // Approximate timestamp
                
                // Detect different intensity patterns
                if (level > -10) {
                    // Sudden spike - good for ultra-short clips
                    if (currentIntensity < -20) {
                        moments.push({
                            timestamp,
                            intensity: 'spike',
                            suggestedType: 'ultra_short',
                            confidence: 0.9
                        });
                    }
                    currentIntensity = level;
                    peakIntensity = Math.max(peakIntensity, level);
                    
                    if (!intensityStart) {
                        intensityStart = timestamp;
                    }
                    sustainedHighIntensity++;
                    
                } else if (level > -20 && level < -10) {
                    // Medium intensity - good for standard clips
                    if (sustainedHighIntensity > 10) {
                        moments.push({
                            timestamp: intensityStart,
                            intensity: 'sustained',
                            suggestedType: 'standard_short',
                            confidence: 0.7
                        });
                    }
                    sustainedHighIntensity = 0;
                    
                } else {
                    // Low intensity period ended
                    if (intensityStart && sustainedHighIntensity > 20) {
                        // Long intense period - good for extended clips
                        moments.push({
                            timestamp: intensityStart,
                            intensity: 'extended',
                            suggestedType: 'extended_play',
                            confidence: 0.8
                        });
                    }
                    intensityStart = null;
                    sustainedHighIntensity = 0;
                }
                
                currentIntensity = level;
            }
        }
        
    } catch (error) {
        console.error('Audio analysis error:', error);
    }
    
    return moments;
}

// Detect scene changes for visual excitement
async function analyzeSceneChanges(chunkFile, startOffset) {
    const moments = [];
    
    try {
        // Detect scene changes using ffmpeg
        const sceneData = execSync(
            `ffmpeg -i ${chunkFile} -filter:v "select='gt(scene,0.4)',showinfo" -f null - 2>&1 | grep showinfo`,
            { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 }
        ).trim();
        
        if (sceneData) {
            const scenes = sceneData.split('\n');
            let rapidChanges = 0;
            let lastSceneTime = 0;
            
            for (const scene of scenes) {
                const timeMatch = scene.match(/pts_time:(\d+\.?\d*)/);
                if (timeMatch) {
                    const sceneTime = parseFloat(timeMatch[1]);
                    const actualTime = startOffset + sceneTime;
                    
                    // Rapid scene changes indicate action
                    if (sceneTime - lastSceneTime < 2) {
                        rapidChanges++;
                        
                        if (rapidChanges > 3) {
                            moments.push({
                                timestamp: actualTime,
                                intensity: 'rapid_scenes',
                                suggestedType: 'quick_moment',
                                confidence: 0.75
                            });
                            rapidChanges = 0;
                        }
                    } else {
                        rapidChanges = 0;
                    }
                    
                    lastSceneTime = sceneTime;
                }
            }
        }
        
    } catch (error) {
        console.error('Scene analysis error:', error);
    }
    
    return moments;
}

// Combine audio and visual moments with smart scoring
function combineAndScoreMoments(audioMoments, sceneMoments) {
    const combined = [];
    const allMoments = [...audioMoments, ...sceneMoments];
    
    // Group moments within 5 seconds of each other
    const groupedMoments = [];
    for (const moment of allMoments) {
        const nearbyGroup = groupedMoments.find(group => 
            Math.abs(group[0].timestamp - moment.timestamp) < 5
        );
        
        if (nearbyGroup) {
            nearbyGroup.push(moment);
        } else {
            groupedMoments.push([moment]);
        }
    }
    
    // Score each group
    for (const group of groupedMoments) {
        const hasAudio = group.some(m => m.intensity === 'spike' || m.intensity === 'sustained');
        const hasVisual = group.some(m => m.intensity === 'rapid_scenes');
        
        // Multi-factor scoring
        let score = 0.5;
        if (hasAudio && hasVisual) score = 0.9; // Both audio and visual = best
        else if (hasAudio) score = 0.7;
        else if (hasVisual) score = 0.6;
        
        // Determine best clip type based on moment characteristics
        const suggestedType = determineBestClipType(group);
        
        combined.push({
            timestamp: group[0].timestamp,
            score,
            suggestedType,
            factors: group.map(g => g.intensity)
        });
    }
    
    return combined;
}

// Intelligently determine best clip length for moment
function determineBestClipType(momentGroup) {
    const intensities = momentGroup.map(m => m.intensity);
    
    if (intensities.includes('spike') && momentGroup.length === 1) {
        return 'ultra_short'; // 7 seconds - perfect for sudden moments
    }
    
    if (intensities.includes('rapid_scenes')) {
        return 'quick_moment'; // 15 seconds - good for fast action
    }
    
    if (intensities.includes('extended')) {
        return Math.random() > 0.5 ? 'extended_play' : 'max_short'; // 45 or 59 seconds
    }
    
    return 'standard_short'; // 30 seconds - safe default
}

// Classify moments into optimal clip lengths
function classifyMomentsByType(moments) {
    return moments.map(moment => ({
        ...moment,
        clipConfig: CLIP_CONFIGS[moment.suggestedType],
        targetPlatforms: CLIP_CONFIGS[moment.suggestedType].platforms
    }));
}

// Create clips with variable lengths
async function createVariableLengthClips(vodUrl, moments, streamId, userId, platform) {
    const clips = [];
    
    // Sort by score and diversify by type
    const sortedMoments = moments.sort((a, b) => b.score - a.score);
    
    // Ensure variety in clip lengths (optimal distribution)
    const distribution = {
        'ultra_short': 1,      // 1 ultra-short (7s)
        'quick_moment': 2,     // 2 quick moments (15s)
        'standard_short': 3,   // 3 standard (30s)
        'extended_play': 1,    // 1 extended (45s)
        'max_short': 2         // 2 max length (59s)
    };
    
    const selectedMoments = [];
    
    // First pass: fulfill distribution requirements
    for (const [type, count] of Object.entries(distribution)) {
        const typeMoments = sortedMoments.filter(m => 
            m.suggestedType === type && 
            !selectedMoments.includes(m)
        ).slice(0, count);
        
        selectedMoments.push(...typeMoments);
    }
    
    // Second pass: fill remaining slots with best scoring moments
    if (selectedMoments.length < 9) {
        const remaining = sortedMoments.filter(m => !selectedMoments.includes(m))
            .slice(0, 9 - selectedMoments.length);
        selectedMoments.push(...remaining);
    }
    
    // Create clips with appropriate lengths
    for (const moment of selectedMoments) {
        try {
            const clipDuration = moment.clipConfig.duration;
            const paddingBefore = Math.min(5, clipDuration * 0.2); // 20% padding before
            const clipStart = Math.max(0, moment.timestamp - paddingBefore);
            
            // Generate unique S3 key
            const s3Key = `clips/${userId}/${streamId}_${moment.timestamp}_${clipDuration}s.mp4`;
            
            console.log(`Creating ${clipDuration}s clip at timestamp ${moment.timestamp}`);
            
            // Upload directly to S3
            await uploadClipToS3(vodUrl, clipStart, clipDuration, s3Key);
            
            // Calculate platform-specific score
            const platformScore = moment.score * moment.clipConfig.scoreBoost;
            
            // Create database entry with rich metadata
            const { data: clip } = await supabase.from('clips').insert({
                user_id: userId,
                source_platform: platform,
                source_id: streamId,
                video_url: `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${s3Key}`,
                duration: clipDuration,
                ai_score: platformScore,
                status: 'pending_metadata',
                stream_timestamp: new Date().toISOString(),
                metadata: {
                    clip_type: moment.suggestedType,
                    target_platforms: moment.targetPlatforms,
                    intensity_factors: moment.factors,
                    original_timestamp: moment.timestamp,
                    clip_config: moment.clipConfig.description,
                    platform_optimized: {
                        youtube: clipDuration === 59 || clipDuration === 30,
                        tiktok: clipDuration <= 30
                    }
                }
            }).select().single();
            
            clips.push(clip);
            
        } catch (error) {
            console.error(`Failed to create ${moment.clipConfig.duration}s clip:`, error);
        }
    }
    
    return clips;
}

// Deduplicate moments from overlapping chunks
function deduplicateMoments(existing, newMoments) {
    return newMoments.filter(newMoment => {
        return !existing.some(existingMoment => {
            const timeDiff = Math.abs(existingMoment.timestamp - newMoment.timestamp);
            return timeDiff < 5 && existingMoment.suggestedType === newMoment.suggestedType;
        });
    });
}

// Get VOD URLs for each platform
async function getVODUrl(platform, streamId, channelName) {
    switch(platform) {
        case 'twitch':
            return await getTwitchVOD(streamId, channelName);
        case 'kick':
            return await getKickVOD(channelName);
        case 'youtube':
            return `https://www.youtube.com/watch?v=${streamId}`;
        default:
            throw new Error(`Unsupported platform: ${platform}`);
    }
}

// Get Twitch VOD with retry logic
async function getTwitchVOD(streamId, channelName) {
    const maxAttempts = 10;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
        try {
            const { data: connection } = await supabase
                .from('streaming_connections')
                .select('access_token')
                .eq('platform', 'twitch')
                .single();
            
            const response = await fetch(`https://api.twitch.tv/helix/videos?user_login=${channelName}`, {
                headers: {
                    'Client-ID': process.env.TWITCH_CLIENT_ID,
                    'Authorization': `Bearer ${connection.access_token}`
                }
            });
            
            const data = await response.json();
            const recentVOD = data.data.find(vod => {
                const vodTime = new Date(vod.created_at);
                const hoursSince = (Date.now() - vodTime) / 3600000;
                return hoursSince < 12;
            });
            
            if (recentVOD) {
                return recentVOD.url;
            }
            
        } catch (error) {
            console.log(`Attempt ${attempts + 1}: VOD not ready yet`);
        }
        
        await new Promise(resolve => setTimeout(resolve, Math.min(60000 * Math.pow(2, attempts), 300000)));
        attempts++;
    }
    
    return null;
}

// Get Kick VOD URL
async function getKickVOD(channelName) {
    const kickUrl = `https://kick.com/${channelName}`;
    
    try {
        const response = await fetch(kickUrl);
        const html = await response.text();
        const vodMatch = html.match(/\/video\/([a-f0-9-]+)/);
        
        if (vodMatch) {
            return `https://kick.com/video/${vodMatch[1]}`;
        }
    } catch (error) {
        console.error('Kick VOD fetch error:', error);
    }
    
    return null;
}

// Get VOD metadata
async function getVODInfo(vodUrl) {
    return new Promise((resolve, reject) => {
        ytDlp.getVideoInfo(vodUrl)
            .then(info => resolve({
                duration: info.duration,
                title: info.title,
                thumbnail: info.thumbnail,
                filesize: info.filesize_approx
            }))
            .catch(reject);
    });
}

// Download chunk to temp file
async function downloadChunk(vodUrl, startTime, endTime) {
    const tempFile = path.join(os.tmpdir(), `chunk_${Date.now()}.mp4`);
    
    return new Promise((resolve, reject) => {
        const args = [
            vodUrl,
            '-o', tempFile,
            '--external-downloader', 'ffmpeg',
            '--external-downloader-args', `-ss ${startTime} -to ${endTime}`,
            '--quiet',
            '--no-warnings'
        ];
        
        ytDlp.exec(args)
            .then(() => resolve(tempFile))
            .catch(reject);
    });
}

// Upload clip directly to S3
async function uploadClipToS3(vodUrl, startTime, duration, s3Key) {
    return new Promise((resolve, reject) => {
        const args = [
            vodUrl,
            '--external-downloader', 'ffmpeg',
            '--external-downloader-args', `-ss ${startTime} -t ${duration}`,
            '-o', '-',
            '--quiet'
        ];
        
        const ytdlpProcess = ytDlp.execStream(args);
        
        const uploadParams = {
            Bucket: process.env.S3_BUCKET,
            Key: s3Key,
            Body: ytdlpProcess.stdout,
            ContentType: 'video/mp4'
        };
        
        s3.upload(uploadParams, (error, data) => {
            if (error) reject(error);
            else resolve(data);
        });
    });
}

// Queue clips for batch AI processing
async function queueClipsForProcessing(clips, userId) {
    const batchId = `batch_${Date.now()}`;
    
    // Group by priority based on score and length
    for (const clip of clips) {
        const priority = clip.ai_score > 0.8 ? 'high' : 
                        clip.duration <= 15 ? 'high' : 'normal';
        
        await supabase.from('clip_processing_queue').insert({
            clip_id: clip.id,
            user_id: userId,
            batch_id: batchId,
            status: 'pending',
            priority,
            target_platforms: clip.metadata.target_platforms
        });
    }
    
    console.log(`Queued ${clips.length} variable-length clips for batch ${batchId}`);
}

// Get breakdown of clip types created
function getClipBreakdown(clips) {
    const breakdown = {};
    for (const clip of clips) {
        const duration = clip.duration;
        const key = `${duration}s`;
        breakdown[key] = (breakdown[key] || 0) + 1;
    }
    return breakdown;
}

// Log metrics for optimization
async function logProcessingMetrics(userId, clips) {
    const metrics = {
        total_clips: clips.length,
        average_score: clips.reduce((sum, c) => sum + c.ai_score, 0) / clips.length,
        length_distribution: getClipBreakdown(clips),
        timestamp: new Date().toISOString()
    };
    
    await supabase.from('analytics_events').insert({
        user_id: userId,
        event_type: 'vod_processed',
        metadata: metrics
    });
}