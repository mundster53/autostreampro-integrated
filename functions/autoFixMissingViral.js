exports.handler = async (event, context) => {
  console.log('[AutoFix] Checking for clips missing viral content...');
  
  try {
    // Find good clips without viral content
    const { data: clipsNeedingViral } = await supabase
      .from('clips')
      .select('id')
      .gte('ai_score', 0.40)
      .is('viral_title', null)
      .limit(10);
    
    for (const clip of clipsNeedingViral || []) {
      // Re-trigger analysis to generate viral content
      await fetch(`${process.env.NETLIFY_URL}/.netlify/functions/analyzeClipContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId: clip.id })
      });
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        fixed: clipsNeedingViral?.length || 0
      })
    };
    
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};