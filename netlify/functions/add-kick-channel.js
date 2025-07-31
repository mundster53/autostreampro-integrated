const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }

  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, kickUsername } = JSON.parse(event.body);

    if (!userId || !kickUsername) {
      throw new Error('Missing userId or kickUsername');
    }

    console.log(`Adding Kick channel ${kickUsername} for user ${userId}`);

    // Skip Kick API verification due to Cloudflare protection
    console.log('Skipping Kick API verification due to Cloudflare protection');

    // Check if connection already exists - WITH BETTER ERROR HANDLING
    let existing = null;
    try {
      const { data, error } = await supabase
        .from('streaming_connections')
        .select('id')
        .eq('user_id', userId)
        .eq('platform', 'kick');
