const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event, context) => {
    // Enable CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        // Find next clip to process
        const { data: nextClip, error } = await supabase
            .from('clips')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
            .limit(1)
            .single();

        if (!nextClip) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ message: 'No clips to process' })
            };
        }

        // Update status to processing
        await supabase
            .from('clips')
            .update({ status: 'processing' })
            .eq('id', nextClip.id);

        // Log activity
        await supabase
            .from('clip_activities')
            .insert({
                clip_id: nextClip.id,
                action: 'Manual processing triggered',
                score: null // Will be updated when AI processes it
            });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                message: 'Processing started',
                clipId: nextClip.id 
            })
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Processing failed' })
        };
    }
};