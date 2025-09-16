// netlify/functions/user-signup.js
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
    const { email, password, promoCode } = JSON.parse(event.body);
    
    // Create service role client
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // First check if email already exists
    const { data: existing } = await supabase
      .from('user_profiles')
      .select('email')
      .eq('email', email)
      .single();

    if (existing) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Email already registered' })
      };
    }

    // Create auth user using service role
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          promo_code: promoCode
        }
      }
    });

    if (error) throw error;

    // Wait a moment for auth to propagate
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Insert profile with matching user_id
    const { error: profileError } = await supabase
      .from('user_profiles')
      .insert({
        user_id: data.user.id,
        email: email,
        subscription_status: 'active',
        subscription_plan: promoCode === 'FREEACCESS' ? 'pro' : 'starter'
      });

    if (profileError) {
      console.error('Profile error:', profileError);
    }

    // Send welcome email
    await fetch('https://autostreampro.com/.netlify/functions/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: email,
        subject: 'Welcome to AutoStreamPro!',
        html: '<h1>Welcome!</h1><p>Your account has been created.</p>'
      })
    });

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        success: true,
        message: 'Account created! Check your email.',
        userId: data.user.id
      })
    };

  } catch (error) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message })
    };
  }
};