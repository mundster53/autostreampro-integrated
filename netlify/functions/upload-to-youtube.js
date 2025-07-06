const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const { clipId } = JSON.parse(event.body || '{}');

    // Get clip data
    const { data: clip, error: clipError } = await supabase
      .from('clips')
      .select('*')
      .eq('id', clipId)
      .single();

    if (clipError || !clip) {
      throw new Error('Clip not found');
    }

    // Get user's YouTube access token
    const { data: connection, error: connError } = await supabase
      .from('streaming_connections')
      .select('access_token, refresh_token')
      .eq('user_id', clip.user_id)
      .eq('platform', 'youtube')
      .single();

    if (connError || !connection) {
      throw new Error('YouTube not connected for this user');
    }

    // Prepare YouTube upload data
    const uploadData = {
      snippet: {
        title: clip.title || `Gaming Highlight - ${clip.game}`,
        description: `Epic ${clip.game} gameplay moment! 🎮\n\nGenerated automatically by AutoStreamPro\n\nDuration: ${clip.duration}s\nAI Score: ${(clip.ai_score * 100).toFixed(0)}%`,
        tags: [clip.game, 'gaming', 'highlights', 'gameplay', 'autostreampro'],
        categoryId: '20' // Gaming category
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false
      }
    };

    // Use YouTube Data API v3 via direct HTTP requests (to avoid googleapis bundling issues)
    const youtubeUploadUrl = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
    
    // Step 1: Initiate resumable upload
    const initResponse = await fetch(youtubeUploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.access_token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': 'video/*'
      },
      body: JSON.stringify(uploadData)
    });

    if (!initResponse.ok) {
      const error = await initResponse.text();
      console.error('YouTube API error:', error);
      throw new Error(`YouTube API error: ${initResponse.status}`);
    }

    // Get upload URL from response headers
    const uploadUrl = initResponse.headers.get('location');
    
    if (!uploadUrl) {
      throw new Error('No upload URL received from YouTube');
    }

    // Step 2: Upload video file
    const videoResponse = await fetch(clip.video_url);
    const videoBuffer = await videoResponse.arrayBuffer();

    const uploadVideoResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/*'
      },
      body: videoBuffer
    });

    if (!uploadVideoResponse.ok) {
      throw new Error(`Video upload failed: ${uploadVideoResponse.status}`);
    }

    const youtubeResult = await uploadVideoResponse.json();
    const youtubeVideoId = youtubeResult.id;

    console.log(`Successfully uploaded to YouTube: ${youtubeVideoId}`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        youtubeId: youtubeVideoId,
        message: 'Video uploaded to YouTube successfully!',
        clipTitle: clip.title,
        youtubeUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`
      })
    };

  } catch (error) {
    console.error('YouTube upload error:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
