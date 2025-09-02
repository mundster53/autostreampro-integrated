const { TwitterApi } = require('twitter-api-v2');

exports.handler = async (event, context) => {
  // Enable CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST'
      }
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { videoData, caption } = JSON.parse(event.body);
    
    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    // Convert base64 to buffer
    const videoBuffer = Buffer.from(videoData, 'base64');
    
    // Upload video to Twitter
    const mediaId = await client.v1.uploadMedia(videoBuffer, { 
      mimeType: 'video/mp4',
      target: 'tweet'
    });

    // Post tweet with video
    const tweet = await client.v2.tweet({
      text: caption,
      media: { media_ids: [mediaId] }
    });

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        tweetId: tweet.data.id,
        message: 'Video posted to Twitter successfully!'
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