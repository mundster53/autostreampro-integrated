const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

// YouTube quota limits
const YOUTUBE_QUOTAS = {
    DAILY_UPLOAD_LIMIT: 50000, // API units per day
    VIDEO_UPLOAD_COST: 1600,   // API units per upload
    MAX_UPLOADS_PER_DAY: 31,   // 50000 / 1600
    MAX_UPLOADS_PER_HOUR: 6,   // Spread throughout day
    MAX_UPLOADS_PER_MINUTE: 2  // Prevent bursts
};

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

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
        const { clipId, retryCount = 0 } = JSON.parse(event.body);
        
        if (!clipId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'clipId is required' })
            };
        }

        // Get clip details
        const { data: clip, error: clipError } = await supabase
            .from('clips')
            .select('*')
            .eq('id', clipId)
            .single();

        if (clipError || !clip) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Clip not found' })
            };
        }

        // Check if already uploaded
        if (clip.youtube_id) {
            console.log('Clip already uploaded:', clip.youtube_id);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    alreadyUploaded: true,
                    youtubeUrl: clip.youtube_url,
                    videoId: clip.youtube_id
                })
            };
        }

        // Check rate limits for this user
        const rateLimitCheck = await checkRateLimits(clip.user_id, supabase);
        if (!rateLimitCheck.allowed) {
            console.log('Rate limit exceeded for user:', clip.user_id);
            
            // Add back to queue for later processing
            if (retryCount < 3) {
                await supabase
                    .from('publishing_queue')
                    .insert({
                        clip_id: clipId,
                        platform: 'youtube',
                        status: 'rate_limited',
                        retry_count: retryCount + 1,
                        retry_after: rateLimitCheck.retryAfter,
                        priority: clip.ai_score ? Math.floor(clip.ai_score * 10) : 5
                    });
            }
            
            return {
                statusCode: 429,
                headers: {
                    ...headers,
                    'Retry-After': rateLimitCheck.retryAfter.toString()
                },
                body: JSON.stringify({
                    error: 'Rate limit exceeded',
                    retryAfter: rateLimitCheck.retryAfter,
                    message: rateLimitCheck.message
                })
            };
        }

        // Get user's YouTube connection
        const { data: connection, error: connError } = await supabase
            .from('streaming_connections')
            .select('*')
            .eq('user_id', clip.user_id)
            .eq('platform', 'youtube')
            .eq('is_active', true)
            .single();

        if (connError || !connection || !connection.refresh_token) {
            console.error('No YouTube connection for user:', clip.user_id);
            
            // Update clip status
            await supabase
                .from('clips')
                .update({ 
                    status: 'failed',
                    error_message: 'YouTube not connected'
                })
                .eq('id', clipId);
            
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'YouTube not connected for this user',
                    needsOAuth: true,
                    userId: clip.user_id
                })
            };
        }

        // Initialize OAuth2 client
        const oauth2Client = new google.auth.OAuth2(
            process.env.YOUTUBE_CLIENT_ID,
            process.env.YOUTUBE_CLIENT_SECRET,
            process.env.YOUTUBE_REDIRECT_URI
        );

        // Set the refresh token
        oauth2Client.setCredentials({
            refresh_token: connection.refresh_token
        });

        // Get a fresh access token
        let credentials;
        try {
            const tokenResponse = await oauth2Client.refreshAccessToken();
            credentials = tokenResponse.credentials;
            oauth2Client.setCredentials(credentials);
        } catch (tokenError) {
            console.error('Token refresh failed:', tokenError);
            
            // Mark connection as inactive if refresh token is invalid
            await supabase
                .from('streaming_connections')
                .update({ 
                    is_active: false,
                    error_message: 'Refresh token invalid - needs reauthorization'
                })
                .eq('id', connection.id);
            
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({
                    error: 'YouTube authorization expired',
                    needsReauth: true,
                    userId: clip.user_id
                })
            };
        }

        // Update the new access token in database
        if (credentials.access_token !== connection.access_token) {
            await supabase
                .from('streaming_connections')
                .update({ 
                    access_token: credentials.access_token,
                    updated_at: new Date().toISOString()
                })
                .eq('id', connection.id);
        }

        // Initialize YouTube API with user's OAuth
        const youtube = google.youtube({
            version: 'v3',
            auth: oauth2Client
        });

        // Download video from storage
        const { data: fileData, error: downloadError } = await supabase.storage
            .from('clips')
            .download(clip.video_url);

        if (downloadError) {
            console.error('Error downloading video:', downloadError);
            
            // If file doesn't exist, mark clip appropriately
            if (downloadError.message?.includes('not found')) {
                await supabase
                    .from('clips')
                    .update({ 
                        status: 'failed',
                        error_message: 'Video file not found in storage'
                    })
                    .eq('id', clipId);
            }
            
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ 
                    error: 'Failed to download video from storage',
                    details: downloadError.message
                })
            };
        }

        // Convert blob to buffer
        const buffer = Buffer.from(await fileData.arrayBuffer());

        // Check video size (YouTube limit is 128GB but we'll warn at 1GB)
        const sizeMB = buffer.length / (1024 * 1024);
        if (sizeMB > 1024) {
            console.warn(`Large video detected: ${sizeMB}MB for clip ${clipId}`);
        }

        // Generate optimized metadata
        const videoMetadata = generateVideoMetadata(clip);

        // Upload to YouTube with retry logic
        let uploadResponse;
        let uploadAttempts = 0;
        const maxUploadAttempts = 3;

        while (uploadAttempts < maxUploadAttempts) {
            try {
                uploadAttempts++;
                console.log(`Upload attempt ${uploadAttempts} for clip ${clipId}`);
                
                uploadResponse = await youtube.videos.insert({
                    part: ['snippet', 'status'],
                    requestBody: videoMetadata,
                    media: {
                        body: buffer
                    }
                });
                
                break; // Success, exit retry loop
                
            } catch (uploadError) {
                console.error(`Upload attempt ${uploadAttempts} failed:`, uploadError.message);
                
                // Check if it's a retryable error
                if (uploadAttempts < maxUploadAttempts && isRetryableError(uploadError)) {
                    // Wait before retrying (exponential backoff)
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, uploadAttempts) * 1000));
                    continue;
                }
                
                // Non-retryable error or max attempts reached
                await supabase
                    .from('clips')
                    .update({ 
                        status: 'failed',
                        error_message: uploadError.message,
                        retry_count: uploadAttempts
                    })
                    .eq('id', clipId);
                
                throw uploadError;
            }
        }

        const youtubeVideoId = uploadResponse.data.id;
        const youtubeUrl = `https://youtube.com/watch?v=${youtubeVideoId}`;

        console.log('Upload successful:', youtubeUrl);

        // Update clip with YouTube info
        await supabase
            .from('clips')
            .update({
                youtube_id: youtubeVideoId,
                youtube_url: youtubeUrl,
                posted_platforms: ['youtube'],
                published_at: new Date().toISOString(),
                status: 'published',
                upload_attempts: uploadAttempts
            })
            .eq('id', clipId);

        // Record upload for rate limiting
        await recordUpload(clip.user_id, supabase);

        // Delete from storage after successful upload
        try {
            await supabase.storage
                .from('clips')
                .remove([clip.video_url]);
            console.log('Deleted video from storage:', clip.video_url);
        } catch (deleteError) {
            console.error('Failed to delete from storage:', deleteError);
            // Don't fail the whole operation if delete fails
        }

        // Update user metrics
        await updateUserMetrics(clip.user_id, supabase);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                youtubeUrl,
                videoId: youtubeVideoId,
                message: "Video uploaded successfully to user's channel",
                attempts: uploadAttempts
            })
        };

    } catch (error) {
        console.error('Upload error:', error);
        
        // Determine if this is a quota error
        const isQuotaError = error.message?.toLowerCase().includes('quota') || 
                           error.code === 403;
        
        return {
            statusCode: isQuotaError ? 429 : 500,
            headers,
            body: JSON.stringify({
                error: 'Upload failed',
                message: error.message,
                isQuotaError,
                details: error.response?.data || error.errors || undefined
            })
        };
    }
};

// Helper Functions

async function checkRateLimits(userId, supabase) {
    const now = new Date();
    const oneMinuteAgo = new Date(now - 60 * 1000);
    const oneHourAgo = new Date(now - 60 * 60 * 1000);
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

    // Get recent uploads
    const { data: recentUploads } = await supabase
        .from('clips')
        .select('published_at')
        .eq('user_id', userId)
        .eq('status', 'published')
        .gte('published_at', oneDayAgo.toISOString())
        .order('published_at', { ascending: false });

    if (!recentUploads) {
        return { allowed: true };
    }

    // Count uploads in different time windows
    const uploadsLastMinute = recentUploads.filter(u => 
        new Date(u.published_at) > oneMinuteAgo
    ).length;
    
    const uploadsLastHour = recentUploads.filter(u => 
        new Date(u.published_at) > oneHourAgo
    ).length;
    
    const uploadsLastDay = recentUploads.length;

    // Check limits
    if (uploadsLastMinute >= YOUTUBE_QUOTAS.MAX_UPLOADS_PER_MINUTE) {
        return {
            allowed: false,
            retryAfter: 60,
            message: 'Minute upload limit reached'
        };
    }

    if (uploadsLastHour >= YOUTUBE_QUOTAS.MAX_UPLOADS_PER_HOUR) {
        return {
            allowed: false,
            retryAfter: 3600,
            message: 'Hourly upload limit reached'
        };
    }

    if (uploadsLastDay >= YOUTUBE_QUOTAS.MAX_UPLOADS_PER_DAY) {
        return {
            allowed: false,
            retryAfter: 86400,
            message: 'Daily upload limit reached'
        };
    }

    return { allowed: true };
}

async function recordUpload(userId, supabase) {
    await supabase
        .from('upload_metrics')
        .insert({
            user_id: userId,
            platform: 'youtube',
            uploaded_at: new Date().toISOString()
        });
}

async function updateUserMetrics(userId, supabase) {
    const { data: metrics } = await supabase
        .from('user_metrics')
        .select('clips_uploaded')
        .eq('user_id', userId)
        .single();

    const currentCount = metrics?.clips_uploaded || 0;

    await supabase
        .from('user_metrics')
        .upsert({
            user_id: userId,
            clips_uploaded: currentCount + 1,
            last_upload: new Date().toISOString()
        }, {
            onConflict: 'user_id'
        });
}

function generateVideoMetadata(clip) {
    // Smart title generation (max 100 chars for YouTube)
    let title = clip.title || `Gaming Highlight - ${clip.game || 'Unknown Game'}`;
    if (title.length > 100) {
        title = title.substring(0, 97) + '...';
    }

    // Generate comprehensive description
    const description = [
        clip.description || 'Check out this amazing gaming moment!',
        '',
        `🎮 Game: ${clip.game || 'Unknown'}`,
        `🔥 Viral Score: ${Math.round((clip.ai_score || 0.5) * 100)}%`,
        `📅 Captured: ${new Date(clip.created_at).toLocaleDateString()}`,
        '',
        '🏷️ Tags:',
        (clip.tags || ['gaming']).map(tag => `#${tag.replace(/\\s+/g, '')}`).join(' '),
        '',
        '👉 Follow for more epic gaming moments!',
        '',
        'Powered by AutoStreamPro - AI-driven clip detection and publishing'
    ].join('\\n');

    // Generate tags (max 500 chars total, max 30 tags)
    const tags = clip.tags || ['gaming', 'highlights', clip.game?.toLowerCase() || 'gameplay'];
    const processedTags = tags
        .slice(0, 30)
        .map(tag => tag.toLowerCase().replace(/[^a-z0-9\\s]/g, '').trim())
        .filter(tag => tag.length > 0);

    return {
        snippet: {
            title,
            description,
            tags: processedTags,
            categoryId: '20', // Gaming category
            defaultLanguage: 'en',
            defaultAudioLanguage: 'en'
        },
        status: {
            privacyStatus: 'public',
            selfDeclaredMadeForKids: false,
            madeForKids: false
        }
    };
}

function isRetryableError(error) {
    const retryableCodes = [500, 502, 503, 504, 408, 429];
    const retryableMessages = ['network', 'timeout', 'enotfound', 'econnreset'];
    
    return retryableCodes.includes(error.code) ||
           retryableMessages.some(msg => 
               error.message?.toLowerCase().includes(msg)
           );
}