const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event, context) => {
  try {
    console.log('Starting bulk YouTube token refresh...');

    // Get all YouTube connections that expire in the next hour
    const oneHourFromNow = new Date(Date.now() + (60 * 60 * 1000));
    
    const { data: expiredConnections, error } = await supabase
      .from('streaming_connections')
      .select('user_id, refresh_token, expires_at')
      .eq('platform', 'youtube')
      .eq('is_active', true)
      .or(`expires_at.is.null,expires_at.lt.${oneHourFromNow.toISOString()}`);

    if (error) throw error;

    console.log(`Found ${expiredConnections.length} YouTube tokens to refresh`);

    let refreshedCount = 0;
    let failedCount = 0;

    for (const connection of expiredConnections) {
      try {
        const refreshResponse = await fetch(`${process.env.NETLIFY_URL}/.netlify/functions/refreshYouTubeToken`, {
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
          refreshedCount++;
        } else {
          failedCount++;
          console.error(`Failed to refresh token for user: ${connection.user_id}`);
        }

      } catch (refreshError) {
        failedCount++;
        console.error(`Error refreshing token for user ${connection.user_id}:`, refreshError);
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        message: 'Bulk token refresh completed',
        totalProcessed: expiredConnections.length,
        refreshedCount,
        failedCount
      })
    };

  } catch (error) {
    console.error('Bulk refresh error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
