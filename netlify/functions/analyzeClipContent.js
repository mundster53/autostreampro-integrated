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
  
  // CHECK IF ALREADY ANALYZED - ADD THIS ENTIRE SECTION
  if (clip.ai_score !== null) {
    console.log('Clip already analyzed. Score:', clip.ai_score);
    
    // If high score but no viral content, generate it
    if (clip.ai_score >= viralThreshold) && !clip.viral_title) {
      console.log('Generating missing viral content...');
      
      const viralResponse = await fetch(`https://beautiful-rugelach-bda4b4.netlify.app/.netlify/functions/generateViralContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId: clipId })
      });
    }
    
    // Return existing analysis
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        clipId: clipId,
        score: clip.ai_score,
        analysis: clip.ai_analysis,
        shouldUpload: clip.ai_score >= viralThreshold),
        message: 'Using existing analysis'
      })
    };
  }
  // END OF NEW SECTION
  
  console.log('Analyzing clip:', clip.title);  // ← THIS LINE STAYS

    // Get user's custom threshold
const { data: userSettings } = await supabase
  .from('user_preferences')
  .select('viral_threshold')
  .eq('user_id', clip.user_id)
  .single();

// Use custom threshold or default to 0.40
const viralThreshold = userSettings?.viral_threshold || 0.40;
console.log(`Using viral threshold: ${viralThreshold}`);

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

// Automatically generate viral content for good clips
if (finalScore >= viralThreshold)) {
  console.log('Score is good! Triggering viral content generation...');
  
  try {
    // Call our separate viral generation function
    const viralResponse = await fetch(`https://beautiful-rugelach-bda4b4.netlify.app/.netlify/functions/generateViralContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clipId: clipId })
    });
    
    const viralResult = await viralResponse.json();
    
    if (viralResult.success) {
      console.log('Viral content generated successfully!');
      // ⬇️ ADD THE YOUTUBE UPLOAD TRIGGER HERE ⬇️
  
  // TRIGGER YOUTUBE UPLOAD
  console.log('Now triggering YouTube upload...');
  
  try {
    const uploadResponse = await fetch(`https://beautiful-rugelach-bda4b4.netlify.app/.netlify/functions/upload-to-youtube`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clipId: clipId })
    });
    
    const uploadResult = await uploadResponse.json();
    
    if (uploadResult.success) {
      console.log('YouTube upload successful!', uploadResult);
    } else {
      console.error('YouTube upload failed:', uploadResult.error);
    }
  } catch (uploadError) {
    console.error('YouTube upload error:', uploadError);
  }
  
  // ⬆️ END OF YOUTUBE UPLOAD TRIGGER ⬆️
    } else {
      console.log('Viral generation skipped:', viralResult.message);
    }
  } catch (viralError) {
    // Don't let viral generation failure break the main flow
    console.error('Viral generation failed, but continuing:', viralError);
  }
}
        const viralContent = JSON.parse(viralResponse.choices[0].message.content);
        
        // Update clip with viral content
        await supabase
          .from('clips')
          .update({
            viral_title: viralContent.title,
            viral_tags: viralContent.tags,
            viral_description: viralContent.description
          })
          .eq('id', clipId);
          
        console.log('Viral content generated:', viralContent.title);
        
      } catch (viralError) {
        console.error('Viral generation failed:', viralError);
        // Continue without viral content - don't break the flow
      }
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        clipId: clipId,
        score: finalScore,
        analysis: fullAnalysis,
        shouldUpload: finalScore >= viralThreshold)
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
