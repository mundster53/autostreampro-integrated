const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getTwitchMP4Url(clip) {
  const debugInfo = {
    source_id: clip.source_id,
    thumbnail_url: clip.thumbnail_url,
    tried_urls: []
  };
  
  // Method 1: Try using Twitch GQL API
  try {
    const gqlResponse = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: `{
          clip(slug: "${clip.source_id}") {
            videoQualities {
              sourceURL
              quality
            }
          }
        }`
      })
    });
    
    const gqlData = await gqlResponse.json();
    debugInfo.gql_response = gqlData;
    
    if (gqlData.data?.clip?.videoQualities?.[0]) {
      const url = gqlData.data.clip.videoQualities[0].sourceURL;
      debugInfo.tried_urls.push({ method: 'GQL', url: url });
      return url;
    }
  } catch (e) {
    debugInfo.gql_error = e.message;
  }
  
  // Method 2: Try constructing from thumbnail
  if (clip.thumbnail_url) {
    const match = clip.thumbnail_url.match(/\/([A-Za-z0-9_-]+)\/\d+-offset-\d+-preview/);
    if (match) {
      const videoId = match[1];
      const url = `https://clips-media-assets2.twitch.tv/${videoId}.mp4`;
      debugInfo.tried_urls.push({ method: 'Thumbnail', url: url });
      debugInfo.thumbnail_video_id = videoId;
      return url;
    }
  }
  
  // Method 3: Try pattern from source_id
  const url = `https://clips-media-assets2.twitch.tv/AT-cm%7C${clip.source_id}.mp4`;
  debugInfo.tried_urls.push({ method: 'Fallback', url: url });
  
  // Return URL and debug info - modify the error handling in the main function
  throw new Error(`DEBUG INFO: ${JSON.stringify(debugInfo, null, 2)}`);
}

exports.handler = async (event, context) => {
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

    const { data: clip, error: clipError } = await supabase
      .from('clips')
      .select('*')
      .eq('id', clipId)
      .single();

    if (clipError || !clip) {
      throw new Error(`Clip not found: ${clipId}`);
    }

    // Get user's YouTube connection with refresh capabilities
    const { data: connection, error: connError } = await supabase
      .from('streaming_connections')
      .select('access_token, refresh_token, platform_username, expires_at, user_id')
      .eq('user_id', clip.user_id)
      .eq('platform', 'youtube')
      .eq('is_active', true)
      .single();

    if (connError || !connection) {
      throw new Error('YouTube not connected for this user');
    }
    
    // Check if token is expired or will expire in next 5 minutes
    const now = new Date();
    const expiresAt = connection.expires_at ? new Date(connection.expires_at) : null;
    const isExpiredSoon = !expiresAt || (expiresAt.getTime() - now.getTime()) < (5 * 60 * 1000);

    let accessToken = connection.access_token;

    if (isExpiredSoon) {
      console.log('Token expired or expiring soon, refreshing...');
      
      // Call refresh token function
      const refreshResponse = await fetch(`https://beautiful-rugelach-bda4b4.netlify.app/.netlify/functions/refreshYouTubeToken`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          refreshToken: connection.refresh_token,
          userId: connection.user_id
        })
      });

      if (refreshResponse.ok) {
        const refreshResult = await refreshResponse.json();
        accessToken = refreshResult.newToken;
        console.log('Token refreshed successfully');
      } else {
        throw new Error('Failed to refresh YouTube token - user needs to reconnect');
      }
    }

    console.log('Found YouTube connection for:', connection.platform_username);

    // Simple test with real YouTube metadata API call
    const testResponse = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!testResponse.ok) {
      throw new Error(`YouTube API test failed: ${testResponse.status}`);
    }

    // Real YouTube video upload
    console.log('Starting real YouTube upload for:', clip.title);
    console.log('Video URL:', clip.video_url);

    // Declare videoBuffer BEFORE the if/else
    let videoBuffer;

    // Handle Twitch clips with temporary download
    if (clip.video_url && clip.video_url.includes('clips.twitch.tv/')) {
        console.log('Processing Twitch clip:', clip.video_url);
        
        try {
            const mp4Url = await getTwitchMP4Url(clip);
            console.log('Got Twitch MP4 URL:', mp4Url);
            
            const videoResponse = await fetch(mp4Url);
            if (!videoResponse.ok) {
                throw new Error(`Failed to download Twitch clip: ${videoResponse.status}`);
            }
            
            videoBuffer = await videoResponse.arrayBuffer();
            console.log('Downloaded Twitch clip, size:', videoBuffer.byteLength);
            
        } catch (error) {
            console.error('Twitch clip download error:', error);
            throw new Error(`Failed to process Twitch clip: ${error.message}`);
        }
    } else {
        // Regular video fetch for non-Twitch URLs
        console.log('Fetching video from:', clip.video_url);
        const videoResponse = await fetch(clip.video_url);
        if (!videoResponse.ok) {
            throw new Error(`Failed to fetch video: ${videoResponse.status}`);
        }
        
        videoBuffer = await videoResponse.arrayBuffer();
        console.log('Video size:', videoBuffer.byteLength, 'bytes');
    }

    // Prepare video metadata
    const metadata = {
      snippet: {
        title: clip.title || `${clip.game} Gaming Highlight`,
        description: `🎮 Epic ${clip.game} gameplay moment!\n\nAI Score: ${Math.round(clip.ai_score * 100)}%\nDuration: ${clip.duration}s\n\n🤖 Auto-generated by AutoStreamPro\n#${clip.game.replace(/\s+/g, '')} #Gaming #Highlights`,
        tags: [clip.game, 'gaming', 'highlights', 'gameplay', 'autostreampro'],
        categoryId: '20' // Gaming category
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false
      }
    };

    // YouTube multipart upload
    const boundary = '-------314159265358979323846';
    const delimiter = '\r\n--' + boundary + '\r\n';
    const closeDelim = '\r\n--' + boundary + '--';

    const metadataBody = delimiter + 
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' + 
      JSON.stringify(metadata);

    const videoBody = delimiter + 
      'Content-Type: video/*\r\n' +
      'Content-Transfer-Encoding: binary\r\n\r\n';

    // Combine parts
    const multipartBody = new Uint8Array(
      new TextEncoder().encode(metadataBody).length +
      new TextEncoder().encode(videoBody).length +
      videoBuffer.byteLength +
      new TextEncoder().encode(closeDelim).length
    );

    let offset = 0;
    const encoder = new TextEncoder();

    // Add metadata
    const metadataBytes = encoder.encode(metadataBody);
    multipartBody.set(metadataBytes, offset);
    offset += metadataBytes.length;

    // Add video header
    const videoHeaderBytes = encoder.encode(videoBody);
    multipartBody.set(videoHeaderBytes, offset);
    offset += videoHeaderBytes.length;

    // Add video data
    multipartBody.set(new Uint8Array(videoBuffer), offset);
    offset += videoBuffer.byteLength;

    // Add closing delimiter
    const closeBytes = encoder.encode(closeDelim);
    multipartBody.set(closeBytes, offset);

    console.log('Uploading to YouTube...');

    // Upload to YouTube
    const uploadUrl = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status';
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'multipart/related; boundary=' + boundary
      },
      body: multipartBody
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('YouTube upload failed:', uploadResponse.status, errorText);
      throw new Error(`YouTube upload failed: ${uploadResponse.status}`);
    }

    const uploadResult = await uploadResponse.json();
    const realYouTubeId = uploadResult.id;

    console.log('Successfully uploaded to YouTube! Video ID:', realYouTubeId);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        youtubeId: realYouTubeId,
        message: 'Video uploaded to YouTube successfully!',
        clipTitle: clip.title,
        youtubeUrl: `https://www.youtube.com/watch?v=${realYouTubeId}`,
        channelName: connection.platform_username
      })
    };

  } catch (error) {
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
