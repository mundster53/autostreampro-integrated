const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

// Generate AI metadata for a single clip
async function generateAIMetadata(clip) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{
                role: "system",
                content: `You are a viral gaming content expert. Generate YouTube metadata that maximizes views.
                Return JSON with:
                - title: Compelling, clickable title with 1 emoji at start (max 90 chars)
                - description: Engaging description with emojis and call-to-action (max 400 chars)
                - tags: Array of exactly 15 relevant gaming tags (no # symbol, lowercase)`
            }, {
                role: "user",
                content: `Game: ${clip.game || 'Gaming'}
Duration: ${clip.duration || 30} seconds
Score: ${Math.round((clip.ai_score || 0.5) * 100)}% viral potential

Create viral YouTube metadata that will get clicks!`
            }],
            response_format: { type: "json_object" },
            temperature: 0.8,
            max_tokens: 300
        });
        
        return JSON.parse(completion.choices[0].message.content);
    } catch (error) {
        console.error('AI generation failed:', error);
        // Fallback metadata
        return {
            title: `🔥 ${clip.game || 'Gaming'} Highlight - Must See!`,
            description: `Incredible gaming moment! Watch this ${clip.duration || 30} second clip!`,
            tags: ['gaming', 'highlights', 'viral', 'clips', 'epic']
        };
    }
}

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
        const { clipId } = JSON.parse(event.body);
        
        if (!clipId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'clipId required' })
            };
        }

        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        // Get clip details
        const { data: clip, error } = await supabase
            .from('clips')
            .select('*')
            .eq('id', clipId)
            .single();

        if (error || !clip) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ error: 'Clip not found' })
            };
        }

        // Skip if already processed
        if (clip.youtube_id) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ 
                    success: true, 
                    message: 'Already processed',
                    youtubeId: clip.youtube_id 
                })
            };
        }

        // Step 1: Generate AI metadata if needed
        if (!clip.ai_generated) {
            console.log(`Generating AI metadata for clip ${clipId}`);
            const aiMetadata = await generateAIMetadata(clip);
            
            await supabase
                .from('clips')
                .update({
                    title: aiMetadata.title,
                    description: aiMetadata.description,
                    tags: aiMetadata.tags,
                    ai_generated: true,
                    metadata_generated_at: new Date().toISOString()
                })
                .eq('id', clipId);
        }

        // Step 2: Upload to YouTube
        console.log(`Uploading clip ${clipId} to YouTube`);
        const uploadResponse = await fetch(`${process.env.URL}/.netlify/functions/upload-to-youtube`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clipId })
        });

        const uploadResult = await uploadResponse.json();

        if (!uploadResult.success) {
            throw new Error(uploadResult.error || 'Upload failed');
        }

        // Step 3: Mark as processed
        await supabase
            .from('clips')
            .update({
                status: 'published',
                youtube_id: uploadResult.videoId,
                youtube_url: uploadResult.youtubeUrl,
                published_at: new Date().toISOString()
            })
            .eq('id', clipId);

        console.log(`Successfully processed clip ${clipId}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                clipId,
                youtubeUrl: uploadResult.youtubeUrl,
                message: 'Clip processed successfully'
            })
        };

    } catch (error) {
        console.error('Processing error:', error);
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