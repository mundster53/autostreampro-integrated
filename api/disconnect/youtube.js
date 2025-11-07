const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const { error } = await supabase
      .from('streaming_connections')
      .update({ is_active: false })
      .eq('user_id', userId)
      .eq('platform', 'youtube');

    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to disconnect',
        details: error.message 
      });
    }

    return res.status(200).json({ 
      success: true,
      message: 'YouTube disconnected successfully' 
    });

  } catch (error) {
    console.error('Disconnect error:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
};
