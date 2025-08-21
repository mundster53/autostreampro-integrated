const StreamMonitor = require('../../functions/stream-monitor');
const KickMonitorStandalone = require('../../services/kick-monitor-standalone');

exports.handler = async (event, context) => {
  console.log('[AutoStart] Automatically starting all monitors...');
  
  try {
    // Start Twitch monitoring
    const twitchMonitor = new StreamMonitor(supabase);
    await twitchMonitor.checkAllStreams();
    
    // Start Kick monitoring
    const kickMonitor = new KickMonitorStandalone(supabase);
    await kickMonitor.start();
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'All monitors started automatically'
      })
    };
    
  } catch (error) {
    console.error('[AutoStart] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};