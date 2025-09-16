// netlify/functions/user-signup.js
const { createClient } = require('@supabase/supabase-js');

// Create admin client with service key
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

exports.handler = async (event, context) => {
  // Handle CORS preflight
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

    // Validate inputs
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

    // Check if promo code is valid
    let discountApplied = false;
    let subscriptionPlan = 'starter';
    let subscriptionStatus = 'trial';
    
    if (promoCode) {
      const { data: promo } = await supabaseAdmin
        .from('promo_codes')
        .select('*')
        .eq('code', promoCode.toUpperCase())
        .eq('is_active', true)
        .single();

      if (promo) {
        // Check if promo code is expired
        if (!promo.expires_at || new Date(promo.expires_at) > new Date()) {
          // Check usage limits
          if (!promo.max_uses || promo.used_count < promo.max_uses) {
            discountApplied = true;
            
            // If 100% discount, give pro plan free
            if (promo.discount_value === 100) {
              subscriptionPlan = 'pro';
              subscriptionStatus = 'active';
            }
            
            // Increment usage count
            await supabaseAdmin
              .from('promo_codes')
              .update({ used_count: promo.used_count + 1 })
              .eq('id', promo.id);
          }
        }
      }
    }

    // Create auth user using the admin API correctly
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: {
        promo_code: promoCode || null
      }
    });

    if (authError) {
      console.error('Auth creation error:', authError);
      
      // Check if user already exists
      if (authError.message && authError.message.includes('already registered')) {
        return {
          statusCode: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
          body: JSON.stringify({ 
            error: authError.message || authError.toString() || 'Database error creating new user',
          details: authError.code || 'No error code'
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
          error: 'Database error creating new user' 
        })
      };
    }

    // Calculate trial end date (14 days from now)
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 14);

    // Create user profile
    const { error: profileError } = await supabaseAdmin
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
      // Clean up auth user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      
      return {
        statusCode: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify({ error: 'Failed to create user profile' })
      };
    }

    // Create subscription record
    const { error: subError } = await supabaseAdmin
      .from('user_subscriptions')
      .insert({
        user_id: authData.user.id,
        status: subscriptionStatus,
        plan: subscriptionPlan,
        type: subscriptionStatus === 'active' && discountApplied ? 'lifetime' : 'monthly',
        trial_start: subscriptionStatus === 'trial' ? new Date().toISOString() : null,
        trial_end: subscriptionStatus === 'trial' ? trialEndDate.toISOString() : null,
        current_period_start: new Date().toISOString(),
        current_period_end: subscriptionStatus === 'active' && discountApplied 
          ? '2099-12-31T00:00:00Z' 
          : trialEndDate.toISOString()
      });

    if (subError) {
      console.error('Subscription creation error:', subError);
      // Don't fail the whole signup if subscription record fails
    }

    // Record promo code usage
    if (promoCode && discountApplied) {
      await supabaseAdmin
        .from('promo_code_uses')
        .insert({
          promo_code: promoCode.toUpperCase(),
          user_id: authData.user.id,
          used_at: new Date().toISOString()
        });
    }

    // Trigger welcome email
    try {
      const lifecycleResponse = await fetch(`${process.env.URL || 'https://autostreampro.com'}/.netlify/functions/user-lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'welcome',
          userId: authData.user.id,
          data: { 
            email: email,
            promoCode: promoCode || null,
            plan: subscriptionPlan
          }
        })
      });
      
      if (!lifecycleResponse.ok) {
        console.error('Welcome email failed but user created successfully');
      }
    } catch (emailError) {
      console.error('Welcome email error:', emailError);
      // Don't fail signup if email fails
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
        trialEndsAt: subscriptionStatus === 'trial' ? trialEndDate.toISOString() : null,
        message: 'Account created successfully! Check your email for confirmation.'
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
        error: 'Failed to create account',
        details: error.message 
      })
    };
  }
};