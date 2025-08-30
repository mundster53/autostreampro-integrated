const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Duncan's user IDs
const DUNCAN_USER_IDS = [
  '99f0c4bb-9016-409e-83ef-2c827698a2d5', // main account (4201 clips)
  'e067a518-c578-4b11-bdfd-470ff92d3d69'  // secondary account (387 clips)
];

async function generateAIContent(clip) {
  try {
    // Check if we already have viral content
    if (clip.viral_title && clip.viral_tags && clip.viral_description) {
      console.log('Using existing viral content for clip:', clip.id);
      return {
        title: clip.viral_title,
        description: clip.viral_description,
        tags: Array.isArray(clip.viral_tags) ? clip.viral_tags : clip.viral_tags.split(',')
      };
    }

    console.log('Generating new AI content for clip:', clip.id);
    
    const prompt = `You are a YouTube optimization expert. Create viral YouTube metadata for this gaming clip:

Game: ${clip.game || 'Gaming'}
Original Title: ${clip.title || 'Gaming Clip'}
Platform: ${clip.source_platform || 'Stream'}
AI Score: ${clip.ai_score ? Math.round(clip.ai_score * 100) + '%' : 'High'}
Duration: ${clip.duration || 30} seconds

Create content that will go VIRAL:

1. Title: Maximum 70 characters. Use psychological triggers, numbers, power words. Make it impossible not to click.

2. Description: 
   - First 125 chars must hook viewers (shows in search)
   - Include story/context about the clip
   - Strong call-to-action
   - 5-10 hashtags at the end
   - 2-3 paragraphs

3. Tags: 25-30 tags including game-specific, trending gaming terms, skill descriptors

Return as JSON:
{
  "title": "your title",
  "description": "your description",
  "tags": ["tag1", "tag2", ...]
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are a YouTube gaming content expert. Your titles regularly get millions of views. You understand gaming culture and what makes content go viral."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.9,
      response_format: { type: "json_object" }
    });

    const aiContent = JSON.parse(completion.choices[0].message.content);
    
    // Save for future use
    await supabase
      .from('clips')
      .update({
        viral_title: aiContent.title,
        viral_tags: aiContent.tags,
        viral_description: aiContent.description
      })
      .eq('id', clip.id);
    
    return aiContent;
    
  } catch (error) {
    console.error('AI generation failed:', error);
    
    // Smart fallback
    const game = clip.game || 'Gaming';
    const score = clip.ai_score ? Math.round(clip.ai_score * 100) : 85;
    
    return {
      title: `${game} Clip That Made Everyone Lose Their Minds! 🤯`,
      description: `This ${game} moment is absolutely legendary! Watch what happens when skill meets opportunity...

This clip scored ${score}% on our viral detector - and you're about to see why! One of the most insane ${game} plays we've ever captured.

🔥 SUBSCRIBE for daily viral gaming content!
🔔 Hit the bell to never miss clips like this!
💬 Drop your reaction in the comments!

#${game.replace(/\s+/g, '')} #Gaming #Viral #Insane #EpicGaming #MustWatch #GamingClips #ProGamer #Twitch #Kick`,
      tags: [
        game.toLowerCase(),
        'gaming',
        'viral',
        'epic',
        'insane',
        'highlights',
        'best moments',
        'pro plays',
        'gaming clips',
        'must watch',
        'twitch highlights',
        'kick clips',
        'legendary',
        'unbelievable',
        'top plays',
        'gaming moments',
        'epic gaming',
        'viral gaming',
        'best clips',
        'insane plays'
      ]
    };
  }
}

exports.handler = async (event, context) => {
  // CORS headers
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
      }
    };
  }

  try {
    console.log('Starting Duncan clips processing...');
    
    // Step 1: Find orphaned storage files and create database entries
    const { data: storageFiles } = await supabase
      .storage
      .from('clips')
      .list();
      
    let orphanedFixed = 0;
    
    if (storageFiles && storageFiles.length > 0) {
      console.log(`Found ${storageFiles.length} files in storage`);
      
      for (const file of storageFiles) {
        // Check if file belongs to Duncan (filename starts with his user_id)
        const isDuncansFile = DUNCAN_USER_IDS.some(id => file.name.startsWith(id));
        
        if (isDuncansFile) {
          // Check if this has a database entry
          const { data: urlData } = supabase
            .storage
            .from('clips')
            .getPublicUrl(file.name);
            
          const { data: existingClip } = await supabase
            .from('clips')
            .select('id')
            .eq('video_url', urlData.publicUrl)
            .single();
            
          if (!existingClip) {
            // Create database entry for orphaned file
            const userId = file.name.split('_')[0];
            
            console.log(`Creating database entry for orphaned Duncan file: ${file.name}`);
            
            await supabase
              .from('clips')
              .insert({
                user_id: userId,
                video_url: urlData.publicUrl,
                title: `Duncan Gaming Highlight - ${new Date(file.created_at).toLocaleDateString()}`,
                game: 'Gaming',
                ai_score: 0.75, // High score to ensure processing
                status: 'ready_for_upload',
                source_platform: 'twitch',
                duration: 30,
                created_at: file.created_at
              });
              
            orphanedFixed++;
          }
        }
      }
      
      console.log(`Fixed ${orphanedFixed} orphaned Duncan files`);
    }
    
    // Step 2: Get Duncan's clips ready for processing
    const { data: duncanClips, error: clipsError } = await supabase
      .from('clips')
      .select('*')
      .in('user_id', DUNCAN_USER_IDS)
      .in('status', ['ready_for_upload', 'ready', 'queued'])
      .gte('ai_score', 0.40)
      .or('posted_platforms.is.null,posted_platforms.eq.[]')
      .order('ai_score', { ascending: false })
      .limit(5); // Process 5 at a time to avoid timeouts
    
    if (clipsError) {
      throw clipsError;
    }
    
    console.log(`Processing ${duncanClips?.length || 0} Duncan clips`);
    
    const results = [];
    
    // Step 3: Process each clip
    for (const clip of duncanClips || []) {
      try {
        console.log(`\nProcessing clip: ${clip.id}`);
        console.log(`Title: ${clip.title}`);
        console.log(`Score: ${clip.ai_score}`);
        console.log(`Video URL: ${clip.video_url}`);
        
        // Update status to prevent double processing
        await supabase
          .from('clips')
          .update({ status: 'processing' })
          .eq('id', clip.id);
        
        // Generate AI content
        console.log('Generating AI content...');
        const aiContent = await generateAIContent(clip);
        console.log(`Generated title: ${aiContent.title}`);
        
        // Update clip with AI content
        const updatedClip = {
          ...clip,
          viral_title: aiContent.title,
          viral_tags: aiContent.tags,
          viral_description: aiContent.description
        };
        
        // Add to publishing queue instead of direct upload
console.log('Adding to publishing queue...');
const { error: queueError } = await supabase
  .from('publishing_queue')
  .insert({
    clip_id: clip.id,
    platform: 'youtube',
    status: 'pending',
    priority: Math.floor(clip.ai_score * 10),
    created_at: new Date().toISOString()
  });

if (queueError) {
  throw queueError;
}

console.log(`✅ Added to publishing queue with priority ${Math.floor(clip.ai_score * 10)}`);

// Update clip status
await supabase
  .from('clips')
  .update({ status: 'queued' })
  .eq('id', clip.id);

results.push({
  clipId: clip.id,
  success: true,
  queued: true,
  priority: Math.floor(clip.ai_score * 10)
});
        
        const uploadResult = await uploadResponse.json();
        
        if (uploadResult.success) {
          console.log(`✅ Successfully uploaded to YouTube: ${uploadResult.youtubeId}`);
          
          // Update database with YouTube info
          await supabase
            .from('clips')
            .update({
              status: 'published',
              posted_platforms: [{
                platform: 'youtube',
                id: uploadResult.youtubeId,
                url: uploadResult.youtubeUrl,
                uploaded_at: new Date().toISOString(),
                title: aiContent.title
              }],
              published_at: new Date().toISOString()
            })
            .eq('id', clip.id);
          
          // Delete from Supabase storage
          if (clip.video_url && clip.video_url.includes('/storage/v1/object/public/clips/')) {
            const fileName = clip.video_url.split('/').pop();
            
            console.log(`Deleting ${fileName} from storage...`);
            const { error: deleteError } = await supabase
              .storage
              .from('clips')
              .remove([fileName]);
              
            if (!deleteError) {
              console.log(`✅ Deleted from storage`);
            } else {
              console.error(`Failed to delete: ${deleteError.message}`);
            }
          }
          
          results.push({
            clipId: clip.id,
            success: true,
            youtubeId: uploadResult.youtubeId,
            title: aiContent.title
          });
          
        } else {
          console.error(`❌ Upload failed: ${uploadResult.error}`);
          
          await supabase
            .from('clips')
            .update({
              status: 'upload_failed',
              metadata: { 
                error: uploadResult.error,
                attempted_at: new Date().toISOString()
              }
            })
            .eq('id', clip.id);
          
          results.push({
            clipId: clip.id,
            success: false,
            error: uploadResult.error
          });
        }
        
        // Delay between uploads to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 3000));
        
      } catch (clipError) {
        console.error(`Error processing clip ${clip.id}:`, clipError);
        
        await supabase
          .from('clips')
          .update({
            status: 'error',
            metadata: { 
              error: clipError.message,
              attempted_at: new Date().toISOString()
            }
          })
          .eq('id', clip.id);
          
        results.push({
          clipId: clip.id,
          success: false,
          error: clipError.message
        });
      }
    }
    
    // Step 4: Summary
    const summary = {
      total_processed: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      orphaned_fixed: orphanedFixed
    };
    
    console.log('\n=== Processing Complete ===');
    console.log(`Processed: ${summary.total_processed}`);
    console.log(`Successful: ${summary.successful}`);
    console.log(`Failed: ${summary.failed}`);
    console.log(`Orphaned files fixed: ${summary.orphaned_fixed}`);
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        summary: summary,
        results: results
      })
    };
    
  } catch (error) {
    console.error('Processing error:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};