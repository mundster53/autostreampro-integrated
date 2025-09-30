// netlify/functions/user-lifecycle.js
const { createClient } = require('@supabase/supabase-js');
const { templates } = require('./email-templates');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event, context) => {
  // Only allow POST
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
    const { action, userId, data } = JSON.parse(event.body);
    
    // Validate required fields
    if (!action || !userId) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify({ error: 'Missing action or userId' })
      };
    }

    // Get user profile
    const { data: userProfile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (profileError || !userProfile) {
      console.error('Profile fetch error:', profileError);
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify({ error: 'User profile not found' })
      };
    }

    let emailSent = false;
    let updateData = {};

    switch (action) {
      case 'welcome':
        // Send welcome email
        const welcomeTemplate = templates.welcome(userProfile.full_name || userProfile.email.split('@')[0]);
        
        // Call send-email function
        const welcomeResponse = await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: userProfile.email,
            subject: welcomeTemplate.subject,
            html: welcomeTemplate.html,
            tags: [{ name: 'type', value: 'welcome' }]
          })
        });

        if (welcomeResponse.ok) {
          emailSent = true;
          // Set trial end date (14 days from now)
          const trialEndDate = new Date();
          trialEndDate.setDate(trialEndDate.getDate() + 14);
          
          updateData = {
            trial_ends_at: trialEndDate.toISOString(),
            subscription_status: 'trial'
          };
        }
        break;

      case 'trial_reminder':
        // Calculate days left in trial
        const trialEnd = new Date(userProfile.trial_ends_at);
        const now = new Date();
        const daysLeft = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
        
        if (daysLeft > 0 && daysLeft <= 3) {
          const reminderTemplate = templates.trialEnding(
            userProfile.full_name || userProfile.email.split('@')[0],
            daysLeft
          );
          
          const reminderResponse = await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: userProfile.email,
              subject: reminderTemplate.subject,
              html: reminderTemplate.html,
              tags: [{ name: 'type', value: 'trial_reminder' }]
            })
          });
          
          emailSent = reminderResponse.ok;
        }
        break;

      case 'clip_published':
        // Send clip published notification
        if (data && data.clipTitle && data.platform && data.clipUrl) {
          const clipTemplate = templates.clipPublished(
            data.clipTitle,
            data.platform,
            data.clipUrl
          );
          
          const clipResponse = await fetch(`${process.env.URL}/.netlify/functions/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: userProfile.email,
              subject: clipTemplate.subject,
              html: clipTemplate.html,
              tags: [{ name: 'type', value: 'clip_published' }]
            })
          });
          
          emailSent = clipResponse.ok;
        }
        break;

      case 'subscription_updated':
        // Update subscription status
        if (data && data.plan && data.status) {
          updateData = {
            subscription_plan: data.plan,
            subscription_status: data.status,
            updated_at: new Date().toISOString()
          };
        }
        break;

      default:
        return {
          statusCode: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
          body: JSON.stringify({ error: 'Invalid action' })
        };
    }

    // Update user profile if needed
    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update(updateData)
        .eq('user_id', userId);

      if (updateError) {
        console.error('Profile update error:', updateError);
      }
    }

    // Log the event
    await supabase
      .from('user_activity_logs')
      .insert({
        user_id: userId,
        activity_type: action,
        metadata: { ...data, email_sent: emailSent },
        created_at: new Date().toISOString()
      });

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ 
        success: true,
        action,
        emailSent,
        message: `Lifecycle action ${action} completed`
      })
    };

  } catch (error) {
    console.error('Lifecycle error:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ 
        error: 'Failed to process lifecycle event',
        details: error.message 
      })
    };
  }
};