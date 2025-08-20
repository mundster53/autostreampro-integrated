const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const openai = new OpenAI({  // ADD THESE LINES
  apiKey: process.env.OPENAI_API_KEY
});

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
async function getKickMP4Url(clip) {
  const debugInfo = {
    source_id: clip.source_id,
    video_url: clip.video_url,
    tried_methods: []
  };
  
  try {
    // Method 1: Direct Kick clip URL
    if (clip.video_url && clip.video_url.includes('kick.com')) {
      debugInfo.tried_methods.push('Direct Kick URL');
      return clip.video_url;
    }
    
    // Method 2: Try to fetch from Kick API
    if (clip.source_id) {
      const kickApiUrl = `https://kick.com/api/v2/clips/${clip.source_id}`;
      debugInfo.tried_methods.push('Kick API');
      
      const response = await fetch(kickApiUrl);
      if (response.ok) {
        const data = await response.json();
        if (data.clip?.video_url) {
          return data.clip.video_url;
        }
      }
    }
    
  } catch (e) {
    debugInfo.error = e.message;
  }
  
  throw new Error(`Could not get Kick video URL. Debug: ${JSON.stringify(debugInfo, null, 2)}`);
}

async function generateAIContent(clip) {
  try {
    // Check if we already have viral content generated
    if (clip.viral_title && clip.viral_tags && clip.viral_description) {
      console.log('Using existing viral content');
      return {
        title: clip.viral_title,
        description: clip.viral_description,
        tags: Array.isArray(clip.viral_tags) ? clip.viral_tags : clip.viral_tags.split(',')
      };
    }

    console.log('Generating new AI content for clip');
    
    const prompt = `You are a YouTube optimization expert. Create viral YouTube metadata for this gaming clip:

Game: ${clip.game || 'Gaming'}
Original Title: ${clip.title || 'Gaming Clip'}
Platform: ${clip.source_platform || 'Stream'}
AI Score: ${clip.ai_score ? Math.round(clip.ai_score * 100) + '%' : 'High'}
Duration: ${clip.duration || 30} seconds
${clip.description ? `Context: ${clip.description}` : ''}

Generate:
1. Title: Create a catchy, engaging title (max 70 chars). Use power words, numbers, and create curiosity. Make viewers NEED to click.

2. Description: Write a compelling description that:
   - Hooks viewers in the first 125 characters (shows in search)
   - Includes relevant keywords naturally
   - Has a clear call-to-action (subscribe, like, comment)
   - Includes 5-10 relevant hashtags at the end
   - Is 2-3 paragraphs long

3. Tags: Generate 20-30 relevant tags including:
   - Game-specific terms
   - Gaming trends
   - Skill levels (pro, insane, epic)
   - Platform terms (twitch, kick, clips)
   - Viral gaming keywords

Format your response as JSON with exactly these keys:
{
  "title": "your title here",
  "description": "your description here",
  "tags": ["tag1", "tag2", "tag3", ...]
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a YouTube SEO expert who creates viral gaming content metadata. Your titles get millions of views."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.8,
      response_format: { type: "json_object" }
    });

    const aiContent = JSON.parse(completion.choices[0].message.content);
    
    // Save the generated content back to the database for future use
    await supabase
      .from('clips')
      .update({
        viral_title: aiContent.title,
        viral_tags: aiContent.tags,
        viral_description: aiContent.description
      })
      .eq('id', clip.id);
    
    return aiContent;
    
  } catch (error) {
    console.error('AI generation failed, using fallback:', error);
    
    // Fallback content if AI fails
    const game = clip.game || 'Gaming';
    const score = clip.ai_score ? Math.round(clip.ai_score * 100) : 75;
    
    return {
      title: score > 70 
        ? `🔥 INSANE ${game} Clip That Broke The Internet!`
        : `${game} Moment You Have To See To Believe! 😱`,
      description: `This ${game} clip is absolutely incredible! You won't believe what happens...

Watch as this epic ${game} moment unfolds - this is why we love gaming! This clip scored ${score}% on our viral AI detector, making it one of the best clips we've seen.

👉 SUBSCRIBE for more epic ${game} content!
🔔 Turn on notifications to never miss insane clips like this!
💬 Comment your reaction below!

Follow us for more:
📺 Daily uploads of the best gaming moments
🎮 Clips from top streamers and rising stars
🏆 Only the most viral, must-see content

#${game.replace(/\s+/g, '')} #Gaming #Viral #Epic #Insane #MustWatch #GamingClips #Twitch #Kick #Highlights #ProGamer #GamingMoments #ViralGaming #EpicWin`,
      tags: [
        game.toLowerCase(),
        `${game.toLowerCase()} clips`,
        `${game.toLowerCase()} highlights`,
        'gaming',
        'gaming clips',
        'viral gaming',
        'epic moments',
        'insane plays',
        'must watch',
        'pro gamer',
        'twitch clips',
        'kick clips',
        'best moments',
        'gaming highlights',
        'epic gaming',
        'viral clips',
        'insane gaming',
        'top plays',
        'gaming compilation',
        'best of gaming',
        'legendary moments',
        'clutch plays',
        'gaming wins',
        'stream highlights',
        'gamer moments'
      ]
    };
  }
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

// Handle different clip sources
if (clip.video_url) {
  // TWITCH CLIPS
  if (clip.video_url.includes('twitch.tv') || clip.source_platform === 'twitch') {
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
  
  // KICK CLIPS
  } else if (clip.video_url.includes('kick.com') || clip.source_platform === 'kick') {
    console.log('Processing Kick clip:', clip.video_url);
    
    try {
      const mp4Url = await getKickMP4Url(clip);
      console.log('Got Kick MP4 URL:', mp4Url);
      
      const videoResponse = await fetch(mp4Url);
      if (!videoResponse.ok) {
        throw new Error(`Failed to download Kick clip: ${videoResponse.status}`);
      }
      
      videoBuffer = await videoResponse.arrayBuffer();
      console.log('Downloaded Kick clip, size:', videoBuffer.byteLength);
      
    } catch (error) {
      console.error('Kick clip download error:', error);
      throw new Error(`Failed to process Kick clip: ${error.message}`);
    }
  
  // S3 URLs or direct URLs (including the mistakenly stored Supabase files)
  } else {
    console.log('Fetching video from URL:', clip.video_url);
    const videoResponse = await fetch(clip.video_url);
    if (!videoResponse.ok) {
      throw new Error(`Failed to fetch video: ${videoResponse.status}`);
    }
    
    videoBuffer = await videoResponse.arrayBuffer();
    console.log('Video size:', videoBuffer.byteLength, 'bytes');
  }
} else {
  throw new Error('No video URL provided');
}

  // Generate AI content for YouTube
const aiContent = await generateAIContent(clip);

// CHECK IF THIS SHOULD BE A SHORT
const isShort = clip.duration && clip.duration <= 60;

// Modify title for Shorts
if (isShort) {
  // Add #Shorts to title if not already there
  if (!aiContent.title.includes('#Shorts')) {
    // YouTube titles max 100 chars, we use 70, so we have room
    aiContent.title = aiContent.title + ' #Shorts';
  }
  
  // Ensure description has #Shorts as first hashtag
  if (!aiContent.description.includes('#Shorts')) {
    aiContent.description = aiContent.description.replace(
      /(#\w+)/, 
      '#Shorts $1'
    );
  }
  
  console.log(`Uploading as YouTube Short: ${aiContent.title}`);
}

console.log('Generated title:', aiContent.title);
console.log('Tags count:', aiContent.tags.length);

// Prepare video metadata with AI-generated content
const metadata = {
  snippet: {
    title: aiContent.title,
    description: aiContent.description,
    tags: isShort 
      ? ['shorts', ...aiContent.tags.slice(0, 499)] 
      : aiContent.tags.slice(0, 500),
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
    / UPDATE DATABASE WITH YOUTUBE SUCCESS
const isShort = clip.duration && clip.duration <= 60;

await supabase
  .from('clips')
  .update({
    status: 'published',
    posted_platforms: [{
      platform: 'youtube',
      type: isShort ? 'short' : 'video',
      id: realYouTubeId,
      url: `https://www.youtube.com/watch?v=${realYouTubeId}`,
      uploaded_at: new Date().toISOString()
    }],
    published_at: new Date().toISOString()
  })
  .eq('id', clip.id);

console.log(`Updated database: Clip ${clip.id} published as YouTube ${isShort ? 'Short' : 'Video'}`);
   
// Delete from S3 after successful YouTube upload
try {
  // Check if this is an S3 clip
  if (clip.video_url && clip.video_url.includes('amazonaws.com')) {
    const deleteResponse = await fetch(`${process.env.URL || 'https://beautiful-rugelach-bda4b4.netlify.app'}/.netlify/functions/upload-to-s3`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'delete',
        clipId: clip.id
      })
    });
    
    const deleteResult = await deleteResponse.json();
    if (deleteResult.success) {
      console.log('Deleted clip from S3');
    }
  }
} catch (deleteError) {
  console.error('Failed to delete from S3:', deleteError);
  // Don't fail the whole upload if deletion fails
}

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
