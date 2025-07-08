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

    console.log('Analyzing clip:', clip.title);

    // Step 1: Analyze thumbnail with GPT-4 Vision
    let visualScore = 0;
    let analysisReason = "No visual analysis available";
    
    if (clip.thumbnail_url) {
      try {
        const thumbnailAnalysis = await analyzeThumbnailWithGPT4(clip.thumbnail_url, clip.game);
        visualScore = thumbnailAnalysis.score;
        analysisReason = thumbnailAnalysis.reason;
      } catch (err) {
        console.error('Thumbnail analysis failed:', err);
      }
    }

    // Step 2: Analyze metadata patterns
    const metadataScore = analyzeMetadata(clip);
    
    // Step 3: Combine scores intelligently
    const finalScore = calculateFinalScore({
      visual: visualScore,
      metadata: metadataScore,
      game: clip.game,
      duration: clip.duration
    });

    // Step 4: Generate detailed reasoning
    const fullAnalysis = await generateDetailedAnalysis(clip, finalScore, analysisReason);

    // Update database with REAL score
    await supabase
      .from('clips')
      .update({ 
        ai_score: finalScore,
        ai_analysis: fullAnalysis
      })
      .eq('id', clipId);

// TEST: Update viral_title to confirm code reaches here
if (finalScore >= 0.40) {
  await supabase
    .from('clips')
    .update({ 
      viral_title: `TEST - Score: ${finalScore}`
    })
    .eq('id', clipId);
}

// Then your actual viral generation code...
    
// Generate viral content if score is good
if (finalScore >= 0.40) {
    console.log(`[VIRAL] Starting viral generation for clip ${clipId} with score ${finalScore}`);
    
    try {
        console.log('[VIRAL] Generating viral content...');
        
        const viralResponse = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",  // Changed from gpt-4
            messages: [{
                role: "system",
                content: `You are a viral gaming content expert. Create titles that get views but are NOT misleading. Always respond with valid JSON only.`
            }, {
                role: "user",
                content: `Game: ${clip.game || 'Unknown Game'}
                Original: ${clip.title || 'Gaming Clip'}
                Score: ${finalScore}
                
                Return ONLY valid JSON (no other text) with:
                {
                  "title": "One viral title (max 60 chars, use CAPS strategically)",
                  "tags": ["array", "of", "10", "tags", "include", "game", "name", "first"],
                  "description": "2-3 paragraphs with emojis"
                }`
            }],
            // REMOVED response_format parameter
            max_tokens: 400,
            temperature: 0.8
        });
        
        console.log('[VIRAL] Raw response:', viralResponse.choices[0].message.content);
        
        // Clean the response and parse JSON
        const responseContent = viralResponse.choices[0].message.content.trim();
        const viralContent = JSON.parse(responseContent);
        
        console.log('[VIRAL] Parsed content:', viralContent);
        
        // Update clip with viral content
        const updateResult = await supabase
            .from('clips')
            .update({
                viral_title: viralContent.title || 'EPIC Gaming Moment!',
                viral_tags: viralContent.tags || ['gaming', 'viral', 'epic'],
                viral_description: viralContent.description || 'Check out this amazing gaming moment!'
            })
            .eq('id', clipId);
            
        console.log('[VIRAL] Database update result:', updateResult);
        
    } catch (viralError) {
        console.error('[VIRAL] Error generating viral content:', viralError);
        
        // Fallback to pattern-based generation
        const fallbackContent = {
            title: `INSANE ${clip.game || 'Gaming'} Moment You Won't BELIEVE! 🤯`,
            tags: [
                clip.game || 'gaming',
                'viral',
                'epic',
                'clutch',
                'insane',
                'highlights',
                'mustwatch',
                'gamingmoments',
                'clips',
                'autostreampro'
            ],
            description: `🔥 This ${clip.game || 'gaming'} clip is absolutely UNBELIEVABLE!\n\n` +
                         `Watch as this player pulls off one of the most insane plays you'll ever see. ` +
                         `With an AI score of ${Math.round(finalScore * 100)}%, this clip is certified VIRAL material!\n\n` +
                         `👍 SMASH that LIKE button!\n` +
                         `🔔 SUBSCRIBE for daily viral gaming moments!\n` +
                         `💬 Drop your reaction below!`
        };
        
        // Use fallback content
        await supabase
            .from('clips')
            .update({
                viral_title: fallbackContent.title,
                viral_tags: fallbackContent.tags,
                viral_description: fallbackContent.description
            })
            .eq('id', clipId);
            
        console.log('[VIRAL] Used fallback viral content');
    }
}
            
        console.log('[VIRAL] Database update result:', updateResult);
        
        if (updateResult.error) {
            console.error('[VIRAL] Database update error:', updateResult.error);
        } else {
            console.log('[VIRAL] Successfully updated viral content');
        }
        
    } catch (viralError) {
        console.error('[VIRAL] Error generating viral content:', viralError);
        console.error('[VIRAL] Error details:', {
            message: viralError.message,
            stack: viralError.stack,
            response: viralError.response?.data
        });
        
        // Update with error info for debugging
        await supabase
            .from('clips')
            .update({
                viral_title: `ERROR: ${viralError.message?.substring(0, 50)}`
            })
            .eq('id', clipId);
    }
}
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        clipId: clipId,
        score: finalScore,
        analysis: fullAnalysis,
        shouldUpload: finalScore >= 0.40
      })
    };
    
  } catch (error) {
    console.error('Analysis error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};

async function analyzeThumbnailWithGPT4(thumbnailUrl, game) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4-vision-preview",
      messages: [{
        role: "system",
        content: `You are an expert at identifying viral gaming moments. Analyze gaming thumbnails for viral potential.
        
        High viral potential (0.7-1.0):
        - Multiple enemies/explosions visible
        - Player in critical situation
        - Unusual/glitched moments
        - Victory/defeat screens with impressive stats
        - Funny/unexpected positions or events
        
        Medium potential (0.4-0.69):
        - Standard combat scenes
        - Some visual effects
        - Decent action visible
        
        Low potential (0.0-0.39):
        - Static scenes
        - Menus/loading screens
        - Empty environments
        - Nothing happening`
      }, {
        role: "user",
        content: [
          {
            type: "text",
            text: `Analyze this ${game} gaming thumbnail for viral potential. Return JSON with score (0-1) and reason.`
          },
          {
            type: "image_url",
            image_url: { url: thumbnailUrl }
          }
        ]
      }],
      response_format: { type: "json_object" },
      max_tokens: 200
    });
    
    const result = JSON.parse(response.choices[0].message.content);
    console.log('GPT-4 Vision analysis:', result);
    
    return {
      score: Math.max(0, Math.min(1, result.score || 0)),
      reason: result.reason || "Analysis completed"
    };
    
  } catch (error) {
    console.error('GPT-4 Vision error:', error);
    return { score: 0.3, reason: "Visual analysis failed" };
  }
}

function analyzeMetadata(clip) {
  let score = 0.35; // Higher base score
  
  // Title analysis - more keywords and better matching
  const excitingWords = ['insane', 'crazy', 'epic', 'clutch', 'ace', 'pentakill', 
                        'quadra', 'triple', '1v4', '1v5', 'comeback', 'perfect',
                        'flawless', 'destroyed', 'obliterated', 'unbelievable',
                        'super', 'earth', 'victory', 'win', 'best', 'amazing',
                        'wild', 'savage', 'godlike', 'legendary'];
  
  const titleLower = (clip.title || '').toLowerCase();
  let titleBoosts = 0;
  
  for (const word of excitingWords) {
    if (titleLower.includes(word)) {
      titleBoosts++;
      score += 0.08; // Each word adds 8%
    }
  }
  
  // Duration analysis (15-45 seconds is optimal)
  if (clip.duration >= 15 && clip.duration <= 45) {
    score += 0.15; // Increased from 0.1
  } else if (clip.duration > 10 && clip.duration <= 60) {
    score += 0.05; // Partial credit
  } else if (clip.duration > 60) {
    score -= 0.05; // Reduced penalty
  }
  
  // Game-specific boosts - expanded list
  const viralGames = ['valorant', 'fortnite', 'warzone', 'apex', 'league of legends',
                     'overwatch', 'helldivers', 'destiny', 'call of duty', 'battlefield',
                     'counter-strike', 'cs:', 'rocket league', 'minecraft', 'among us'];
  
  const gameLower = (clip.game || '').toLowerCase();
  
  if (viralGames.some(game => gameLower.includes(game))) {
    score += 0.15; // Increased from 0.1
  }
  
  // Special boost for action games
  if (gameLower.includes('helldivers') || gameLower.includes('warzone') || 
      gameLower.includes('apex') || gameLower.includes('valorant')) {
    score += 0.1; // Action game bonus
  }
  
  return Math.max(0, Math.min(1, score));
}

function calculateFinalScore(scores) {
  // Weighted average with visual analysis being most important
  const weights = {
    visual: 0.7,    // What happens in the clip
    metadata: 0.3   // Supporting signals
  };
  
  let finalScore = (scores.visual * weights.visual) + 
                   (scores.metadata * weights.metadata);
  
  // Apply game-specific adjustments
  if (scores.game && scores.game.toLowerCase().includes('fortnite')) {
    finalScore *= 1.1; // Fortnite clips tend to do well
  }
  
  return Math.max(0, Math.min(1, finalScore));
}

async function generateDetailedAnalysis(clip, score, visualReason) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{
        role: "system",
        content: "You are a viral content expert. Provide brief, actionable analysis of gaming clips."
      }, {
        role: "user",
        content: `Gaming clip analysis:
        Title: ${clip.title}
        Game: ${clip.game}
        Duration: ${clip.duration}s
        Visual Analysis: ${visualReason}
        Final Score: ${score}
        
        Provide a 2-3 sentence analysis explaining the viral potential and what would make it better.`
      }],
      max_tokens: 150
    });
    
    return {
      score: score,
      visualReason: visualReason,
      summary: response.choices[0].message.content,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    return {
      score: score,
      visualReason: visualReason,
      summary: `Score: ${(score * 100).toFixed(0)}%. ${visualReason}`,
      timestamp: new Date().toISOString()
    };
  }
}
