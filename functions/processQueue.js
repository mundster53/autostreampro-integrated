// functions/processQueue.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// --- posting limits (env-overridable) ---
// This function currently runs for YouTube; keep it generic if you later duplicate per platform.
const PLATFORM = process.env.PROCESS_PLATFORM || 'youtube'; // 'youtube' by default
const PLATFORM_DAILY_CAP = +(process.env.YOUTUBE_DAILY_CAP ?? 10); // safe conservative cap

// Top-N clips per user per day by tier (you can tune via env without code changes)
const TOPN = {
  starter: +(process.env.TOPN_STARTER ?? 8),
  pro:     +(process.env.TOPN_PRO     ?? 14),
  elite:   +(process.env.TOPN_ELITE   ?? 20),
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      }
    };
  }

  try {
    console.log('Starting queue processing...');

    // Pull a generous pending batch (highest ai_score first); we'll enforce per-user/day limits below.
    const { data: pendingUploads, error } = await supabase
      .from('publishing_queue')
      .select(`
        *,
        clips!inner (
          ai_score,
          title,
          game,
          video_url,
          user_id,
          created_at,
          youtube_id
        )
      `)
      .eq('platform', PLATFORM)
      .eq('status', 'pending')
      .gte('clips.ai_score', 0.25) // Only process clips with score >= 0.25
      .order('ai_score', { ascending: false, foreignTable: 'clips' })
      .limit(200);

    if (error) throw error;

    // Track how many we publish per user within THIS run to avoid overshooting Top-N.
    const processedThisRun = new Map();
    const todayISO = new Date().toISOString().split('T')[0] + 'T00:00:00';

    for (const upload of (pendingUploads || [])) {
      try {
        // ---------- PER-USER + PER-DAY LIMITING (Top-N by tier + platform cap) ----------
        const userId = upload.clips.user_id;

        // Get user's tier (fallback to 'starter'; map any unknown/enterprise to 'elite' if you prefer)
        const { data: userProfile } = await supabase
          .from('user_profiles')
          .select('subscription_plan, viral_threshold')
          .eq('user_id', userId)
          .single();

        const tierRaw = (userProfile?.subscription_plan || 'starter').toLowerCase();
        const tier = ['starter','pro','elite'].includes(tierRaw) ? tierRaw
                   : (tierRaw === 'enterprise' ? 'elite' : 'starter');

        const topNPerDay = TOPN[tier] ?? TOPN.starter;

        // Per-user viral threshold with 0.25–0.95 server clamp
        const rawThreshold = Number(userProfile?.viral_threshold);
        const userThreshold = Math.min(0.95, Math.max(0.25, Number.isFinite(rawThreshold) ? rawThreshold : 0.25));

        // Skip if this clip’s score is below the user’s chosen threshold
        if ((upload.clips.ai_score ?? 0) < userThreshold) {
        console.log(`[YouTube] Skip ${upload.clip_id}: score ${upload.clips.ai_score} < threshold ${userThreshold}`);
        continue;
      }

        // Count how many YouTube posts this user already has today.
        // Using your existing pattern: clips.youtube_id != null indicates a published YouTube video.
        const { count: userUploadsToday } = await supabase
          .from('published_content')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('platform', PLATFORM)   // 'youtube'
          .gte('published_at', todayISO);

        // How many we have already taken for this user in THIS run?
        const alreadyThisRun = processedThisRun.get(userId) || 0;

        // Available slots today for this user on this platform
        const dailyAllowance = Math.min(topNPerDay, PLATFORM_DAILY_CAP);
        const remaining = dailyAllowance - (userUploadsToday || 0) - alreadyThisRun;

        if (remaining <= 0) {
          console.log(
            `Skip ${upload.clip_id}: user ${userId} has no remaining ${PLATFORM} slots today ` +
            `(tier=${tier}, allowance=${dailyAllowance}, used=${userUploadsToday || 0}, thisRun=${alreadyThisRun})`
          );
          continue; // go to next pending upload
        }

        // ---------- END PER-USER LIMITING ----------

        // Optional: mark as 'processing' to reduce duplicate work if multiple runners overlap
        await supabase
          .from('publishing_queue')
          .update({
            status: 'pending',                 // keep your existing status if other code expects 'pending'
            attempts: (upload.attempts || 0) + 1
          })
          .eq('id', upload.id);

        // Hand off to your existing YouTube uploader function
        const uploadResult = await fetch(
          `https://beautiful-rugelach-bda4b4.netlify.app/.netlify/functions/upload-to-youtube`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clipId: upload.clip_id })
          }
        );

        if (!uploadResult.ok) {
          const errorText = await uploadResult.text();
          throw new Error(`HTTP ${uploadResult.status}: ${errorText}`);
        }

        const response = await uploadResult.json();
        if (!response.success) {
          throw new Error(response.error || 'Upload failed');
        }

        // Mark queue item completed
        await supabase
          .from('publishing_queue')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString()
          })
          .eq('id', upload.id);

        // Record in published_content (keeps your existing downstream trackers happy)
        await supabase
          .from('published_content')
          .insert({
            clip_id: upload.clip_id,
            user_id: upload.clips.user_id,
            platform: 'youtube',
            platform_post_id: response.youtubeId,
            platform_url: response.youtubeUrl || `https://www.youtube.com/watch?v=${response.youtubeId}`,
            published_at: new Date().toISOString(),
            last_metrics_update: new Date().toISOString(),
            metrics: {}
          });

          // ✅ Count this success toward today's in-run allowance (no charge on failure)
          processedThisRun.set(userId, (processedThisRun.get(userId) || 0) + 1);

        console.log(`Successfully processed: ${upload.clip_id}`);

      } catch (uploadError) {
        console.error(`Upload error for ${upload.clip_id}:`, uploadError.message);

        await supabase
          .from('publishing_queue')
          .update({
            status: 'failed',
            last_error: uploadError.message
          })
          .eq('id', upload.id);
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        processed: pendingUploads ? pendingUploads.length : 0,
        message: 'Queue processed successfully'
      })
    };

  } catch (error) {
    console.error('Queue processing error:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};
