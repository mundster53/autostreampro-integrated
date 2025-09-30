// netlify/functions/manage-waitlist.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  // Simple admin check - you should enhance this
  const adminToken = event.headers['x-admin-token'];
  if (adminToken !== process.env.ADMIN_SECRET) {
    return {
      statusCode: 401,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }

  const { action, count = 10 } = JSON.parse(event.body || '{}');
  
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    switch(action) {
      case 'stats':
        // Get waitlist stats
        const { count: totalWaiting } = await supabase
          .from('waitlist')
          .select('*', { count: 'exact', head: true })
          .is('invited_at', null);
        
        const { data: phase } = await supabase
          .from('launch_phases')
          .select('*')
          .eq('is_active', true)
          .single();
        
        const { count: totalInvited } = await supabase
          .from('waitlist')
          .select('*', { count: 'exact', head: true })
          .not('invited_at', 'is', null);
        
        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({
            waiting: totalWaiting,
            invited: totalInvited,
            currentPhase: phase?.phase_number,
            spotsUsed: phase?.current_users,
            spotsAvailable: phase ? phase.max_users - phase.current_users : 0
          })
        };

      case 'invite':
        // Send invitations to next batch
        const { data: phase2 } = await supabase
          .from('launch_phases')
          .select('*')
          .eq('is_active', true)
          .single();
        
        const spotsAvailable = phase2 ? phase2.max_users - phase2.current_users : 0;
        const toInvite = Math.min(count, spotsAvailable);
        
        if (toInvite <= 0) {
          return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ 
              message: 'No spots available in current phase',
              spotsAvailable: 0 
            })
          };
        }
        
        // Get next people in line
        const { data: nextBatch } = await supabase
          .from('waitlist')
          .select('*')
          .is('invited_at', null)
          .order('position', { ascending: true })
          .limit(toInvite);
        
        if (!nextBatch?.length) {
          return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ message: 'No one waiting' })
          };
        }
        
        // Mark as invited and send emails
        const invited = [];
        for (const person of nextBatch) {
          // Update invitation timestamp
          await supabase
            .from('waitlist')
            .update({ invited_at: new Date().toISOString() })
            .eq('id', person.id);
          
          // Send invitation email
          await fetch('https://autostreampro.com/.netlify/functions/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: person.email,
              subject: '🎉 Your AutoStreamPro invitation is here!',
              html: `
                <h2>Your spot is ready!</h2>
                <p>Great news! A spot has opened up and you're invited to join AutoStreamPro.</p>
                <p><strong>Your invitation code:</strong> ${person.invite_code}</p>
                <p><a href="https://autostreampro.com/signup.html?invite=${person.invite_code}" style="background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block;">Claim Your Spot</a></p>
                <p>This invitation expires in 48 hours. Don't miss out!</p>
              `
            })
          }).catch(e => console.error('Email failed:', e));
          
          invited.push(person.email);
        }
        
        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ 
            success: true,
            invited: invited.length,
            emails: invited
          })
        };

      case 'new-phase':
        // Open a new phase (next 500 spots)
        await supabase
          .from('launch_phases')
          .update({ is_active: false })
          .eq('is_active', true);
        
        const { data: newPhase } = await supabase
          .from('launch_phases')
          .insert({
            phase_number: (await supabase.from('launch_phases').select('phase_number').order('phase_number', { ascending: false }).limit(1).single()).data.phase_number + 1,
            is_active: true,
            opened_at: new Date().toISOString()
          })
          .select()
          .single();
        
        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ 
            success: true,
            newPhase: newPhase.phase_number
          })
        };

      default:
        return {
          statusCode: 400,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'Invalid action' })
        };
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message })
    };
  }
};