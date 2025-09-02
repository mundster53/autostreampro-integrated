exports.handler = async (event, context) => {
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

  try {
    const { videoData, caption, accessToken } = JSON.parse(event.body);

    // Step 1: Create media container
    const containerResponse = await fetch(`https://graph.instagram.com/v16.0/me/media`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        media_type: 'VIDEO',
        video_url: videoData, // This would need to be a public URL
        caption: caption,
        access_token: accessToken
      })
    });

    const containerData = await containerResponse.json();

    if (!containerData.id) {
      throw new Error('Failed to create media container');
    }

    // Step 2: Publish the media
    const publishResponse = await fetch(`https://graph.instagram.com/v16.0/me/media_publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        creation_id: containerData.id,
        access_token: accessToken
      })
    });

    const publishData = await publishResponse.json();

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        media_id: publishData.id,
        message: 'Video posted to Instagram successfully!'
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