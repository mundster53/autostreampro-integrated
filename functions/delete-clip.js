const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event, context) => {
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
        const { clipId, userId } = JSON.parse(event.body);

        // Verify ownership
        const { data: clip } = await supabase
            .from('clips')
            .select('user_id')
            .eq('id', clipId)
            .single();

        if (!clip || clip.user_id !== userId) {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'Unauthorized' })
            };
        }

        // Delete the clip
        const { error } = await supabase
            .from('clips')
            .delete()
            .eq('id', clipId)
            .eq('user_id', userId);

        if (error) throw error;

        // Also delete from publishing queue if exists
        await supabase
            .from('publishing_queue')
            .delete()
            .eq('clip_id', clipId);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                success: true,
                message: 'Clip deleted successfully'
            })
        };

    } catch (error) {
        console.error('Delete clip error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to delete clip',
                details: error.message
            })
        };
    }
};