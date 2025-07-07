const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

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
    const { data: clip, error } = await supabase
      .from('clips')
      .select('*')
      .eq('id', clipId)
      .single();
      
    if (error || !clip) {
      throw new Error('Clip not found');
    }

    console.log('Processing Twitch clip:', clip.source_id);

    // Step 1: Get Twitch clip download URL
    const mp4Url = await getTwitchMP4Url(clip);
    
    // Step 2: Download to memory (not disk)
    const videoResponse = await fetch(mp4Url);
    const videoBuffer = await videoResponse.arrayBuffer();
    
    console.log('Downloaded clip, size:', videoBuffer.byteLength);
    
    // Step 3: Quick AI scoring based on metadata
    // (In production, you'd analyze the video here)
    const aiScore = await quickScore(clip);
    
    // Update database with score
    await supabase
      .from('clips')
      .update({ ai_score: aiScore })
      .eq('id', clipId);
    
    // Step 4: If score is good, upload to YouTube
    if (aiScore >= 0.40) {
      console.log('Score', aiScore, '- uploading to YouTube');
      
      // Call YouTube upload with the buffer
      const uploadResult = await uploadToYouTube(clip, videoBuffer);
      
      // Save to published_content
      await supabase
        .from('published_content')
        .insert({
          clip_id: clipId,
          platform: 'youtube',
          platform_post_id: uploadResult.youtubeId,
          platform_url: uploadResult.youtubeUrl
        });
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          score: aiScore,
          uploaded: true,
          youtubeId: uploadResult.youtubeId
        })
      };
    } else {
      console.log('Score', aiScore, '- skipping upload');
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          score: aiScore,
          uploaded: false,
          reason: 'Score below threshold'
        })
      };
    }
    
    // Video buffer is automatically garbage collected - no cleanup needed!
    
  } catch (error) {
    console.error('Process error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};

async function getTwitchMP4Url(clip) {
  // Method 1: Try using Twitch GQL API (most reliable)
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
    if (gqlData.data?.clip?.videoQualities?.[0]) {
      return gqlData.data.clip.videoQualities[0].sourceURL;
    }
  } catch (e) {
    console.error('GQL method failed:', e);
  }
  
  // Method 2: Try constructing from thumbnail
  if (clip.thumbnail_url) {
    // Extract video ID from thumbnail
    const match = clip.thumbnail_url.match(/\/([A-Za-z0-9_-]+)\/\d+-offset-\d+-preview/);
    if (match) {
      const videoId = match[1];
      return `https://clips-media-assets2.twitch.tv/${videoId}.mp4`;
    }
  }
  
  throw new Error('Could not determine Twitch MP4 URL');
}

async function quickScore(clip) {
  // Simple scoring for now
  let score = 0.35;
  const title = (clip.title || '').toLowerCase();
  
  if (title.includes('epic') || title.includes('insane')) score += 0.2;
  if (title.includes('super') || title.includes('earth')) score += 0.1;
  if (clip.duration >= 15 && clip.duration <= 45) score += 0.1;
  
  return Math.min(score, 0.95);
}

async function uploadToYouTube(clip, videoBuffer) {
  // Reuse your existing YouTube upload logic
  // But pass the videoBuffer instead of fetching
  
  // ... YouTube upload code ...
  
  // For now, simulate success
  return {
    youtubeId: `test_${Date.now()}`,
    youtubeUrl: `https://youtube.com/watch?v=test_${Date.now()}`
  };
}
