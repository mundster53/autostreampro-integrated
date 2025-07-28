const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  try {
    // Get all Kick connections
    const { data: connections } = await supabase
      .from('streaming_connections')
      .select('*')
      .eq('platform', 'kick')
      .eq('is_active', true);

    for (const connection of connections) {
      await checkStream(connection);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, checked: connections.length })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

async function checkStream(connection) {
  const response = await fetch(`https://kick.com/api/v2/channels/${connection.platform_username}`);
  const data = await response.json();

  if (!data.livestream?.is_live) return;

  // Monitor chat for 30 seconds
  const chatExcitement = await monitorChat(data.chatroom.id);
  
  if (chatExcitement > 75) {
    await createClip(connection, data.livestream, chatExcitement);
  }
}

async function monitorChat(chatroomId) {
  return new Promise((resolve) => {
    let excitement = 0;
    const ws = new WebSocket('wss://ws-us2.pusher.com/app/eb1d5f283081a78b932c?protocol=7');
    
    setTimeout(() => {
      ws.close();
      resolve(excitement);
    }, 30000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel: `chatrooms.${chatroomId}.v2` }
      }));
    });

    ws.on('message', (data) => {
      const message = JSON.parse(data);
      if (message.event === 'App\\Events\\ChatMessageEvent') {
        const chat = JSON.parse(message.data);
        // Check for excitement
        if (/clip|pog|insane|omg/i.test(chat.content)) {
          excitement += 20;
        }
      }
    });
  });
}

async function createClip(connection, streamData, excitement) {
  // Call OpenAI for scoring
  const aiScore = await callOpenAIForScoring({
    game: streamData.categories?.[0]?.name || 'Gaming',
    excitement: excitement,
    viewers: streamData.viewer_count
  });

  const clipData = {
    user_id: connection.user_id,
    source_platform: 'kick',
    source_id: `kick_${streamData.id}_${Date.now()}`,
    title: `${streamData.categories?.[0]?.name || 'Gaming'} - Epic Moment!`,
    game: streamData.categories?.[0]?.name || 'Gaming',
    duration: 30,
    thumbnail_url: streamData.thumbnail?.url,
    video_url: `https://kick.com/${connection.platform_username}`,
    ai_score: aiScore,
    status: 'pending_manual_download',
    created_at: new Date().toISOString()
  };

  await supabase.from('clips').insert(clipData);
}

async function callOpenAIForScoring(data) {
  // Reuse your existing OpenAI scoring logic
  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{
        role: "system",
        content: "Score this gaming moment from 0-1 for viral potential"
      }, {
        role: "user",
        content: JSON.stringify(data)
      }],
      max_tokens: 50
    });
    
    return parseFloat(response.choices[0].message.content) || 0.5;
  } catch (error) {
    return Math.random() * 0.4 + 0.6; // Fallback
  }
}
