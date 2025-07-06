const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }

  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const { clipId } = JSON.parse(event.body || '{}');
    console.log('Processing clip upload:', clipId);

    // Get clip data
    const { data: clip, error: clipError } = await supabase
      .from('clips')
      .select('*')
      .eq('id', clipId)
      .single();

    if (clipError || !clip) {
      throw new Error(`Clip not found: ${clipId}`);
    }

    console.log('Found clip:', clip.title);

    // Get user's YouTube access token
    const { data: connection, error: connError } = await supabase
      .from('streaming_connections')
      .select('access_token, refresh_token, platform_username')
      .eq('user_id', clip.user_id)
      .eq('platform', 'youtube')
      .eq('is_active', true)
      .single();

    if (connError || !connection) {
      throw new Error('YouTube not connected for this user');
    }

    console.log('Found YouTube connection for:', connection.platform_username);

    // Check if video URL is accessible
    const videoCheckResponse = await fetch(clip.video_url, { method: 'HEAD' });
    if (!videoCheckResponse.ok) {
      throw new Error(`Video file not accessible: ${clip.video_url}`);
    }

    // For now, let's return success without actually uploading to test the pipeline
    const mockYouTubeId = `test_${Date.now()}`;

    console.log('Mock upload successful for:', clip.title);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        youtubeId: mockYouTubeId,
        message: 'Mock upload successful - function working!',
        clipTitle: clip.title,
        videoUrl: clip.video_url,
        channelName: connection.platform_username,
        debug: {
          clipFound: true,
          connectionFound: true,
          videoAccessible: true
        }
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
