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
    
    // Get clip data
    const { data: clip, error } = await supabase
      .from('clips')
      .select('*')
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
      const viralResponse = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{
          role: "system",
          content: `You are a viral YouTube gaming content expert. Create unique, clickable content that gets views. Be creative and avoid templates.`
        }, {
          role: "user",
          content: `Create viral YouTube content for this gaming clip:
          
          Game: ${clip.game || 'Gaming'}
          Original Title: ${clip.title || 'Gaming Clip'}
          Duration: ${clip.duration || 30} seconds
          AI Score: ${Math.round(clip.ai_score * 100)}%
          
          Generate:
          1. A catchy YouTube title (max 60 chars, use CAPS strategically)
          2. 10-15 relevant tags/keywords (mix of specific and trending)
          3. An engaging description (2-3 paragraphs with emojis)
          
          Make each unique based on the game and content. Be specific to ${clip.game}.
          
          Return as JSON:
          {
            "title": "your title here",
            "tags": ["tag1", "tag2", ...],
            "description": "your description here"
          }`
        }],
        max_tokens: 500,
        temperature: 0.8
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
