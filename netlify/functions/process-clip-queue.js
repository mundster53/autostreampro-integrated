const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

// AI Metadata Generation with GPT-3.5 Turbo (30x cheaper than GPT-4)
async function enrichClipWithAI(clipId, supabase) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    try {
        // Get clip details
        const { data: clip, error } = await supabase
            .from('clips')
            .select('*')
            .eq('id', clipId)
            .single();
        
        if (error || !clip) {
            console.error('Clip not found:', clipId);
            return null;
        }
        
        // Skip if already has AI metadata
        if (clip.ai_generated && clip.title && clip.description && clip.tags) {
            console.log('Clip already has AI metadata:', clipId);
            return clip;
        }
        
        console.log('Generating AI metadata for clip:', clipId);
        
        // Generate AI metadata with GPT-3.5 Turbo
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo", // 30x cheaper than GPT-4!
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
Platform: ${clip.source_platform || 'Twitch'}

Create viral YouTube metadata that will get clicks!`
            }],
            response_format: { type: "json_object" },
            temperature: 0.8, // More creative titles
            max_tokens: 300
        });
        
        const aiMetadata = JSON.parse(completion.choices[0].message.content);
        
        // Ensure quality
        if (!aiMetadata.title) aiMetadata.title = `🎮 Epic ${clip.game || 'Gaming'} Moment!`;
        if (!aiMetadata.description) aiMetadata.description = 'Check out this insane gaming moment! Like and subscribe for more epic clips!';
        if (!aiMetadata.tags || aiMetadata.tags.length === 0) {
            aiMetadata.tags = ['gaming', 'clips', 'highlights', 'epic', 'viral'];
        }
        
        // Update clip with AI metadata
        const { error: updateError } = await supabase
            .from('clips')
            .update({
                title: aiMetadata.title.substring(0, 100), // YouTube limit
                description: aiMetadata.description.substring(0, 5000), // YouTube limit
                tags: aiMetadata.tags.slice(0, 30), // YouTube max 30 tags
                ai_generated: true,
                metadata_generated_at: new Date().toISOString()
            })
            .eq('id', clipId);
        
        if (updateError) {
            console.error('Failed to update clip with AI metadata:', updateError);
            return clip;
        }
        
        console.log(`✅ AI metadata generated for clip ${clipId} - Cost: ~$0.0004`);
        return { ...clip, ...aiMetadata };
        
    } catch (error) {
        console.error('AI metadata generation failed:', error);
        
        // Fallback metadata if AI fails
        const fallbackMetadata = {
            title: `🔥 ${clip.game || 'Gaming'} Highlight - Must See!`,
            description: `Incredible gaming moment! Watch this ${clip.duration || 30} second clip that scored ${Math.round((clip.ai_score || 0.5) * 100)}% on our viral scale!`,
            tags: ['gaming', 'highlights', 'viral', 'clips', 'epic', 'twitch', 'youtube', 'mustwatch']
        };
        
        await supabase
            .from('clips')
            .update({
                title: fallbackMetadata.title,
                description: fallbackMetadata.description,
                tags: fallbackMetadata.tags,
                ai_generated: false,
                metadata_generated_at: new Date().toISOString()
            })
            .eq('id', clipId);
        
        return { ...clip, ...fallbackMetadata };
    }
}

// Upload to YouTube function
async function uploadToYouTube(clipId) {
    try {
        const response = await fetch(`${process.env.URL}/.netlify/functions/upload-to-youtube`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clipId })
        });
        
        const result = await response.json();
        return {
            clipId,
            success: result.success || false,
            error: result.error,
            youtubeUrl: result.youtubeUrl
        };
    } catch (error) {
        console.error('Upload to YouTube failed:', error);
        return {
            clipId,
            success: false,
            error: error.message
        };
    }
}

// Process a batch of clips
async function processBatch(batch, supabase) {
    const results = [];
    
    for (const clip of batch) {
        try {
            console.log(`Processing clip ${clip.id}...`);
            
            // Skip if already uploaded
            if (clip.youtube_id || clip.status === 'published') {
                console.log(`Clip ${clip.id} already uploaded, skipping`);
                results.push({
                    clipId: clip.id,
                    success: true,
                    skipped: true,
                    message: 'Already uploaded'
                });
                continue;
            }
            
            // FIRST: Generate AI metadata (only costs $0.0004 per clip!)
            await enrichClipWithAI(clip.id, supabase);
            
            // THEN: Upload to YouTube (will use the AI-generated metadata)
            const uploadResult = await uploadToYouTube(clip.id);
            
            results.push(uploadResult);
            
            // Add delay to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between uploads
            
        } catch (error) {
            console.error(`Failed to process clip ${clip.id}:`, error);
            results.push({ 
                clipId: clip.id, 
                success: false, 
                error: error.message 
            });
        }
    }
    
    return results;
}

// Clean up orphaned files in storage
async function cleanupOrphanedFiles(supabase) {
    try {
        console.log('Checking for orphaned files in storage...');
        
        // Get all files in storage
        const { data: storageFiles, error: listError } = await supabase.storage
            .from('clips')
            .list();
        
        if (listError) {
            console.error('Error listing storage files:', listError);
            return 0;
        }
        
        if (!storageFiles || storageFiles.length === 0) {
            console.log('No files in storage');
            return 0;
        }
        
        // Get all clips that reference storage files
        const { data: clips } = await supabase
            .from('clips')
            .select('video_url');
        
        const clipsUrls = new Set(clips?.map(c => c.video_url) || []);
        
        // Find orphaned files
        const orphanedFiles = storageFiles.filter(file => 
            !clipsUrls.has(file.name) && file.name !== '.emptyFolderPlaceholder'
        );
        
        if (orphanedFiles.length > 0) {
            console.log(`Found ${orphanedFiles.length} orphaned files`);
            
            // Delete orphaned files in batches
            const batchSize = 10;
            for (let i = 0; i < orphanedFiles.length; i += batchSize) {
                const batch = orphanedFiles.slice(i, i + batchSize).map(f => f.name);
                const { error: deleteError } = await supabase.storage
                    .from('clips')
                    .remove(batch);
                
                if (deleteError) {
                    console.error('Error deleting orphaned files:', deleteError);
                } else {
                    console.log(`Deleted ${batch.length} orphaned files`);
                }
            }
        }
        
        return orphanedFiles.length;
        
    } catch (error) {
        console.error('Cleanup error:', error);
        return 0;
    }
}

// Main handler
exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        console.log('Starting clip queue processing...');

        // Parse request body for options
        const { 
            batchSize = 5, 
            specificUserId = null,
            cleanupOrphans = true 
        } = event.body ? JSON.parse(event.body) : {};

        // Clean up orphaned files first (if enabled)
        let orphanedFilesFound = 0;
        if (cleanupOrphans) {
            orphanedFilesFound = await cleanupOrphanedFiles(supabase);
        }

        // Build query for clips to process
        let query = supabase
            .from('clips')
            .select('*')
            .in('status', ['ready_for_upload', 'queued', 'pending', 'analyzing'])
            .is('youtube_id', null)
            .order('ai_score', { ascending: false }) // Process highest scoring clips first
            .limit(batchSize);

        // If specific user requested (like Duncan)
        if (specificUserId) {
            query = query.eq('user_id', specificUserId);
        }

        // Special handling for Duncan's clips
        const duncanUserIds = [
            '99f0c4bb-9016-409e-83ef-2c827698a2d5',
            'e067a518-c578-4b11-bdfd-470ff92d3d69'
        ];
        
        // First try to get Duncan's clips
        const { data: duncanClips, error: duncanError } = await supabase
            .from('clips')
            .select('*')
            .in('user_id', duncanUserIds)
            .in('status', ['ready_for_upload', 'queued', 'pending', 'analyzing'])
            .is('youtube_id', null)
            .order('ai_score', { ascending: false })
            .limit(batchSize);

        let clipsToProcess = [];
        
        if (duncanClips && duncanClips.length > 0) {
            console.log(`Found ${duncanClips.length} Duncan clips to process`);
            clipsToProcess = duncanClips;
        } else {
            // If no Duncan clips, get regular clips
            const { data: regularClips, error: clipsError } = await query;
            
            if (clipsError) {
                throw clipsError;
            }
            
            clipsToProcess = regularClips || [];
        }

        if (clipsToProcess.length === 0) {
            console.log('No clips in queue to process');
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    message: 'No clips to process',
                    orphanedFilesFound,
                    clipsProcessed: 0
                })
            };
        }

        console.log(`Processing ${clipsToProcess.length} clips...`);

        // Process the batch
        const results = await processBatch(clipsToProcess, supabase);

        // Count successes and failures
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success && !r.skipped).length;
        const skipped = results.filter(r => r.skipped).length;

        // Log summary
        console.log(`Queue processing complete: ${successful} successful, ${failed} failed, ${skipped} skipped`);

        // Calculate costs
        const aiCost = successful * 0.0004; // GPT-3.5 Turbo cost per clip
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'Queue processing complete',
                orphanedFilesFound,
                clipsProcessed: clipsToProcess.length,
                results,
                summary: {
                    successful,
                    failed,
                    skipped,
                    estimatedAICost: `$${aiCost.toFixed(4)}`
                }
            })
        };

    } catch (error) {
        console.error('Queue processing error:', error);
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