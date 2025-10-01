const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        // Get all pending clips
        const { data: clips, error } = await supabase
            .from('clips')
            .select('id, ai_score')
            .in('status', ['ready_for_upload', 'queued', 'pending', 'analyzing'])
            .is('youtube_id', null)
            .order('ai_score', { ascending: false })
            .limit(1000);

        if (error) throw error;

        if (!clips || clips.length === 0) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    message: 'No pending clips found',
                    processed: 0
                })
            };
        }

        console.log(`Found ${clips.length} pending clips to process`);

        // Process in parallel batches of 25
        const batchSize = 25;
        const results = [];
        
        for (let i = 0; i < clips.length; i += batchSize) {
            const batch = clips.slice(i, i + batchSize);
            console.log(`Processing batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(clips.length/batchSize)}`);
            
            // Process batch in parallel
            const batchPromises = batch.map(clip => 
                fetch(`${process.env.URL}/.netlify/functions/process-single-clip`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clipId: clip.id })
                }).then(r => r.json()).catch(err => ({
                    success: false,
                    clipId: clip.id,
                    error: err.message
                }))
            );
            
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            
            // Wait 3 seconds between batches to respect YouTube quotas
            if (i + batchSize < clips.length) {
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }

        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        console.log(`Batch processing complete: ${successful} successful, ${failed} failed`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: `Processed ${clips.length} clips`,
                summary: {
                    total: clips.length,
                    successful,
                    failed,
                    estimatedTime: `${Math.ceil(clips.length / batchSize * 3)} seconds`
                },
                results: results.slice(0, 10) // Return first 10 results for debugging
            })
        };

    } catch (error) {
        console.error('Batch processing error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                success: false,
                error: error.message
            })
        };
    }
};