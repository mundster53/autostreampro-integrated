// netlify/functions/join-waitlist.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { email } = JSON.parse(event.body);
    
    if (!email) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Email required' })
      };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Check if spots are available in current phase
    const { data: phase } = await supabase
      .from('launch_phases')
      .select('*')
      .eq('is_active', true)
      .single();

    if (phase && phase.current_users < phase.max_users) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ 
          status: 'spots_available',
          message: 'Spots available! Redirecting to signup...',
          redirect: '/signup.html'
        })
      };
    }

    // Check if already on waitlist
    const { data: existing } = await supabase
      .from('waitlist')
      .select('position')
      .eq('email', email)
      .single();

    if (existing) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ 
          status: 'already_joined',
          position: existing.position,
          message: `You're already on the waitlist at position #${existing.position}`
        })
      };
    }

    // Get current waitlist count for position
    const { count } = await supabase
      .from('waitlist')
      .select('*', { count: 'exact', head: true });

    const position = (count || 0) + 1;

    // Add to waitlist
    const { error } = await supabase
      .from('waitlist')
      .insert({ email, position });

    if (error) {
      throw error;
    }

    // Send confirmation email
    await fetch('https://autostreampro.com/.netlify/functions/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: email,
        subject: `You're #${position} on the AutoStreamPro waitlist!`,
        html: `
          <h2>You're on the list!</h2>
          <p>You're #${position} in line for AutoStreamPro.</p>
          <p>We're releasing 500 spots at a time to ensure the best experience. You'll receive an invitation email when your spot opens up.</p>
          <p>Get ready to turn your gaming clips into viral content!</p>
        `
      })
    }).catch(e => console.error('Email failed:', e));

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        success: true,
        position,
        message: `You're #${position} on the waitlist!`
      })
    };

  } catch (error) {
    console.error('Waitlist error:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Failed to join waitlist' })
    };
  }
};