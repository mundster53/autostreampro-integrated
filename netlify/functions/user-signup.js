// netlify/functions/user-signup.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { email, password, promoCode } = JSON.parse(event.body);

    if (!email || !password) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify({ error: 'Email and password required' })
      };
    }

    // Create Supabase client with service key for admin operations
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // First check if user already exists
    const { data: existingAuth } = await supabase
      .from('user_profiles')
      .select('email')
      .eq('email', email)
      .single();

    if (existingAuth) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify({ 
          error: 'An account with this email already exists. Please sign in instead.'
        })
      };
    }

    // Try to sign up the user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email,
      password: password
    });

    if (authError) {
      // Check for specific error types
      if (authError.message.includes('already registered')) {
        return {
          statusCode: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
          body: JSON.stringify({ 
            error: 'This email is already registered. Please sign in or use a different email.'
          })
        };
      }
      
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify({ 
          error: authError.message || 'Failed to create account'
        })
      };
    }

    if (!authData.user) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify({ 
          error: 'Failed to create user account - please try again'
        })
      };
    }

    // Calculate trial end date (14 days)
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 14);

    // Check promo code
    let subscriptionPlan = 'starter';
    let subscriptionStatus = 'trial';
    
    if (promoCode && promoCode.toUpperCase() === 'FREEACCESS') {
      subscriptionPlan = 'pro';
      subscriptionStatus = 'active';
    }

    // Create user profile - check if it already exists first
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('user_id', authData.user.id)
      .single();

    if (!existingProfile) {
      const { error: profileError } = await supabase
        .from('user_profiles')
        .insert({
          user_id: authData.user.id,
          email: email,
          subscription_status: subscriptionStatus,
          subscription_plan: subscriptionPlan,
          trial_ends_at: subscriptionStatus === 'trial' ? trialEndDate.toISOString() : null,
          virality_threshold: 0.40,
          created_at: new Date().toISOString()
        });

      if (profileError) {
        console.error('Profile creation error:', profileError);
        // Return the actual error message
        return {
          statusCode: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
          body: JSON.stringify({ 
            error: `Profile error: ${profileError.message}. Please contact support.`
          })
        };
      }
    }

    // Send welcome email
    try {
      await fetch('https://autostreampro.com/.netlify/functions/user-lifecycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'welcome',
          userId: authData.user.id,
          data: { email }
        })
      });
    } catch (e) {
      console.error('Email failed:', e);
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ 
        success: true,
        userId: authData.user.id,
        email: email,
        subscriptionPlan: subscriptionPlan,
        subscriptionStatus: subscriptionStatus,
        message: 'Account created successfully! Check your email to confirm.'
      })
    };

  } catch (error) {
    console.error('Signup error:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ 
        error: 'Server error during signup',
        details: error.message 
      })
    };
  }
};