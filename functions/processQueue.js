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
    const nowIso = new Date().toISOString();

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
          created_at
        )
      `)
      .eq('platform', PLATFORM)
      .eq('status', 'pending')
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`) // only retry-ready or never-scheduled
      .gte('clips.ai_score', 0.25) // Only process clips with score >= 0.25
      .order('ai_score', { ascending: false, foreignTable: 'clips' })
      .limit(200);

    if (error) throw error;

    
    const todayISO = new Date().toISOString().split('T')[0] + 'T00:00:00';

    // Per-run tracking (per-user, per-platform) to avoid overshooting caps in this invocation
    const processedPlatformThisRun = new Map(); // key: `${userId}:${PLATFORM}` -> count

    // Cache today's posted clip_ids (unique) per user
    const postedClipIdsCache = new Map(); // userId -> Set(clip_id)

    async function getPostedSetForUser(userId) {
    if (postedClipIdsCache.has(userId)) return postedClipIdsCache.get(userId);
    const { data, error } = await supabase
      .from('published_content')
      .select('clip_id')
      .eq('user_id', userId)
      .gte('published_at', todayISO);
    if (error) {
    console.warn('getPostedSetForUser error', error);
    }
    const set = new Set((data || []).map(r => r.clip_id));
    postedClipIdsCache.set(userId, set);
    return set;
  }

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

        // ------- UNIQUE CLIP/DAY QUOTA (cross-posting counts as 1) -------
        const postedSet = await getPostedSetForUser(userId);
        const uniqueDailyAllowance = topNPerDay;

        // If we've hit the unique quota and THIS clip hasn't been posted anywhere today, skip it.
        // (If this clip was already posted to another platform today, allow cross-posting.)
        if (postedSet.size >= uniqueDailyAllowance && !postedSet.has(upload.clip_id)) {
          console.log(`[YouTube] Skip new clip ${upload.clip_id}: unique quota reached (${postedSet.size}/${uniqueDailyAllowance})`);
          continue;
        }
        // ------- END UNIQUE CLIP/DAY QUOTA -------

        // ------- PER-PLATFORM DAILY CAP (YouTube) -------
        const { count: platformPublishedToday } = await supabase
          .from('published_content')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('platform', PLATFORM)   // 'youtube'
          .gte('published_at', todayISO);

        const platformKey = `${userId}:${PLATFORM}`;
        const usedThisRun = processedPlatformThisRun.get(platformKey) || 0;
        const platformCap = PLATFORM_DAILY_CAP;
        const remainingPlatform = platformCap - (platformPublishedToday || 0) - usedThisRun;

        if (remainingPlatform <= 0) {
          console.log(`[YouTube] Skip ${upload.clip_id}: platform cap reached (used=${platformPublishedToday || 0}, inRun=${usedThisRun}, cap=${platformCap})`);
          continue;
        }
        // Note: we do NOT reserve here. We only count after a successful publish.
        // ------- END PER-PLATFORM DAILY CAP -------

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

          // ✅ Count platform usage for this run (so we don't exceed cap during this invocation)
          processedPlatformThisRun.set(platformKey, (processedPlatformThisRun.get(platformKey) || 0) + 1);

          // ✅ Count a UNIQUE clip only on the first successful publish of this clip today
          if (!postedSet.has(upload.clip_id)) {
          postedSet.add(upload.clip_id);
        }

        console.log(`Successfully processed: ${upload.clip_id}`);

      } catch (uploadError) {
        console.error(`Upload error for ${upload.clip_id}:`, uploadError.message);
        const attemptNo = (upload.attempts || 0) + 1;

      // backoff schedule (minutes). You can override via env later if you want.
      const backoffMins = [5, 15, 60, 180, 360]; // 5m, 15m, 1h, 3h, 6h
      const delayMin = backoffMins[Math.min(attemptNo - 1, backoffMins.length - 1)];
      const nextAttemptAt = new Date(Date.now() + delayMin * 60 * 1000).toISOString();

      await supabase
        .from('publishing_queue')
        .update({
          status: 'pending',           // stay pending; scheduler will skip until next_attempt_at
          last_error: uploadError.message,
          next_attempt_at: nextAttemptAt
          // NOTE: attempts was already incremented earlier in your "mark attempt" update
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
