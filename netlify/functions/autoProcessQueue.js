exports.handler = async (event, context) => {
  console.log('[AutoProcess] Processing clip queue automatically...');
  
  try {
    // Process scoring queue
    const scoreResponse = await fetch(`${process.env.NETLIFY_URL}/.netlify/functions/processScoreQueue`);
    
    // Process upload queue
    const uploadResponse = await fetch(`${process.env.NETLIFY_URL}/.netlify/functions/autoUploadClips`);
    
    // Process cleanup
    const cleanupResponse = await fetch(`${process.env.NETLIFY_URL}/.netlify/functions/autoCleanupS3`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'All queues processed automatically'
      })
    };
    
  } catch (error) {
    console.error('[AutoProcess] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};