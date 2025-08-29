const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const { clipId } = JSON.parse(event.body || '{}');
    
    // Get clip data with user's channel URLs
const { data: clip, error } = await supabase
  .from('clips')
  .select(`
    *,
    user_profiles (
      youtube_channel_url,
      twitch_channel_url,
      kick_channel_url
    )
  `)
  .eq('id', clipId)
  .single();
      
    if (error || !clip) {
      throw new Error('Clip not found');
    }

    // Only generate for clips with good scores
    if (clip.ai_score < 0.40) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: false,
          message: 'Clip score too low for viral generation'
        })
      };
    }

    console.log('Generating viral content for:', clip.title);

    try {
      // Generate viral content with OpenAI
const channelUrls = clip.user_profiles || {};
const primaryChannel = channelUrls.twitch_channel_url || channelUrls.youtube_channel_url || channelUrls.kick_channel_url || '';

const viralResponse = await openai.chat.completions.create({
  model: "gpt-3.5-turbo",
  messages: [{
    role: "system",
    content: `You are an expert in YouTube and Google gaming SEO. You create highly clickable, unique, keyword-rich content that ranks for search and attracts viewers. Avoid generic templates; use trending, relevant topics and viral strategies.`
  }, {
    role: "user",
    content: `Create SEO-optimized YouTube content for this gaming clip:

Game: ${clip.game || 'Gaming'}
Original Title: ${clip.title || 'Gaming Clip'}
Duration: ${clip.duration || 30} seconds
AI Score: ${Math.round(clip.ai_score * 100)}%
Channel URL: ${primaryChannel}

REQUIREMENTS:
1. Title (max 60 chars): Include "${clip.game}" explicitly. Use psychological triggers (curiosity, urgency, exclusivity)
2. Tags (15-20): Mix of exact game name, platform combos ("${clip.game} PC"), long-tail keywords, trending terms
3. Description: 
   - MUST start with: "🔴 Watch LIVE: ${primaryChannel}"
   - Then 2-3 paragraphs with natural keyword placement
   - Include timestamps if relevant
   - End with channel promotion

Return as JSON:
{
  "title": "your title here",
  "tags": ["tag1", "tag2", ...],
  "description": "your description here"
}`
  }],
  max_tokens: 600,
  temperature: 0.85
});

      const viralContent = JSON.parse(viralResponse.choices[0].message.content);
      
      // Update database with viral content
      const updateResult = await supabase
        .from('clips')
        .update({
          viral_title: viralContent.title,
          viral_tags: viralContent.tags,
          viral_description: viralContent.description
        })
        .eq('id', clipId);

      if (updateResult.error) {
        throw updateResult.error;
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          clipId: clipId,
          viralContent: viralContent,
          message: 'Viral content generated successfully!'
        })
      };

    } catch (aiError) {
      console.error('OpenAI generation failed:', aiError);
      
      // Simple fallback - just enhance the existing title
      const enhancedTitle = `${clip.title} - MUST SEE ${clip.game} Moment!`;
      const basicTags = [
        clip.game?.toLowerCase() || 'gaming',
        'gaming',
        'gameplay',
        'viral',
        'epic',
        'mustwatch',
        'gamingclips',
        'youtubegaming',
        'autostreampro'
      ];
      const basicDescription = `Check out this incredible ${clip.game} moment!\n\nThis clip scored ${Math.round(clip.ai_score * 100)}% on our AI viral detection system.\n\nFollow for more epic gaming content!`;

      await supabase
        .from('clips')
        .update({
          viral_title: enhancedTitle.substring(0, 60),
          viral_tags: basicTags,
          viral_description: basicDescription
        })
        .eq('id', clipId);

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          clipId: clipId,
          viralContent: {
            title: enhancedTitle,
            tags: basicTags,
            description: basicDescription
          },
          message: 'Basic viral content applied (AI unavailable)'
        })
      };
    }

  } catch (error) {
    console.error('Viral generation error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
