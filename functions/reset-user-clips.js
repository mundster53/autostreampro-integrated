// netlify/functions/reset-user-clips.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
    // Only allow POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    
    try {
        // Get admin user
        const token = event.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return { statusCode: 401, body: 'Unauthorized' };
        }
        
        // Verify admin
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) {
            return { statusCode: 401, body: 'Invalid token' };
        }
        
        // Check if user is admin (Duncan or other admins)
        const adminEmails = ['duncanmundt1@gmail.com', 'bretmundt53@gmail.com'];
        if (!adminEmails.includes(user.email)) {
            return { statusCode: 403, body: 'Not authorized' };
        }
        
        // Get target user to reset
        const { userId } = JSON.parse(event.body);
        if (!userId) {
            return { statusCode: 400, body: 'userId required' };
        }
        
        // Reset the user's clips
        const { error } = await supabase
            .from('user_profiles')
            .update({
                clips_today: 0,
                daily_limit_reached: false,
                limit_reached_at: null
            })
            .eq('user_id', userId);
        
        if (error) throw error;
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                success: true,
                message: 'Clip limit reset successfully',
                note: 'Backend service may need restart to clear memory cache'
            })
        };
        
    } catch (error) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: error.message })
        };
    }
};