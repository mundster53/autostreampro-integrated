const fetch = globalThis.fetch;
const { createClient } = require('@supabase/supabase-js');

// --- TikTok token refresh helper ---
async function refreshTikTokToken({ userId, refreshToken }) {
  const url = 'https://open.tiktokapis.com/v2/oauth/token/';
  const body = {
    client_key: process.env.TIKTOK_CLIENT_KEY,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(`refresh_failed: ${JSON.stringify(json).slice(0,200)}`);
  }

  const expiresInSec = Number(json.expires_in || 0);
  const newExpiresAt = expiresInSec ? new Date(Date.now() + expiresInSec * 1000).toISOString() : null;

  await supabase
    .from('streaming_connections')
    .update({
      access_token: json.access_token,
      refresh_token: json.refresh_token || refreshToken,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)
    .eq('platform', 'tiktok');

  return { accessToken: json.access_token, refreshToken: json.refresh_token || refreshToken };
}


const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const { clipId, userId, title, privacy } = JSON.parse(event.body);

        // Get clip details
        const { data: clip } = await supabase
            .from('clips')
            .select('*')
            .eq('id', clipId)
            .single();

        if (!clip) {
            throw new Error('Clip not found');
        }

        // Get TikTok connection
        const { data: connection } = await supabase
            .from('streaming_connections')
            .select('access_token, refresh_token')
            .eq('user_id', userId)
            .eq('platform', 'tiktok')
            .single();

        if (!connection) {
            throw new Error('TikTok not connected');
        }

        // Check creator info first (required by TikTok) — refresh token on 401/403
        let accessToken = connection.access_token;
        let refreshToken = connection.refresh_token;

        const creatorInfoUrl = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/';

        async function queryCreatorInfo(token) {
        return fetch(creatorInfoUrl, {
            method: 'POST',
            headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
            }
        });
        }

        let creatorInfoResponse = await queryCreatorInfo(accessToken);

        // If token is expired/invalid, refresh once and retry
        if (!creatorInfoResponse.ok && (creatorInfoResponse.status === 401 || creatorInfoResponse.status === 403)) {
        const refreshed = await refreshTikTokToken({ userId, refreshToken });
        accessToken = refreshed.accessToken;
        refreshToken = refreshed.refreshToken;
        creatorInfoResponse = await queryCreatorInfo(accessToken);
        }

        const creatorInfo = await creatorInfoResponse.json();
        if (!creatorInfoResponse.ok) {
        const msg = creatorInfo?.message || creatorInfo?.error?.message || creatorInfo?.error || `HTTP ${creatorInfoResponse.status}`;
        throw new Error(`Failed to get creator info: ${msg}`);
        }


        // Resolve a canonical video URL (manual_clip_url > video_url > metadata)
        const sourceUrl =
        clip.manual_clip_url ||
        clip.video_url ||
        (clip?.metadata?.video_url) ||
        (clip?.metadata?.s3_key
            ? `https://autostreampro-clips.s3.us-east-2.amazonaws.com/${clip.metadata.s3_key}`
            : null);

        if (!sourceUrl) {
        throw new Error('No playable video URL resolved for this clip');
        }


        // Initialize TikTok upload
        const uploadResponse = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                post_info: {
                    title: title || clip.viral_title || clip.title,
                    privacy_level: privacy || 'SELF_ONLY', // Default to private for safety
                    disable_duet: false,
                    disable_comment: false,
                    disable_stitch: false
                },
                source_info: {
                    source: 'PULL_FROM_URL',
                    video_url: sourceUrl
                }
            })
        });

        const uploadData = await uploadResponse.json();

        if (!uploadResponse.ok) {
            console.error('TikTok upload failed:', uploadData);
            throw new Error(uploadData.error?.message || 'Upload initialization failed');
        }

        // Update clip status
        await supabase
            .from('clips')
            .update({ 
                status: 'processing',
                tiktok_publish_id: uploadData.data.publish_id,
                updated_at: new Date().toISOString()
            })
            .eq('id', clipId);

        // Store publish ID for status checking
        await supabase
            .from('publishing_queue')
            .insert({
                clip_id: clipId,
                platform: 'tiktok',
                publish_id: uploadData.data.publish_id,
                status: 'processing',
                created_at: new Date().toISOString()
            });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                success: true,
                publishId: uploadData.data.publish_id,
                message: 'Video upload initiated. Processing may take a few minutes.'
            })
        };

    } catch (error) {
        console.error('TikTok upload error:', error);
        
        // Log error for debugging
        await supabase
            .from('analytics_events')
            .insert({
                event_type: 'tiktok_upload_error',
                event_data: { 
                    error: error.message,
                    clipId: JSON.parse(event.body).clipId 
                },
                created_at: new Date().toISOString()
            });

        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to upload to TikTok',
                details: error.message 
            })
        };
    }
};