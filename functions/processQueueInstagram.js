// functions/processQueueInstagram.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// --- platform + limits ---
const PLATFORM = 'instagram';
const PLATFORM_DAILY_CAP = +(process.env.IG_DAILY_CAP ?? 15); // conservative default

const TOPN = {
  starter: +(process.env.TOPN_STARTER ?? 8),
  pro:     +(process.env.TOPN_PRO     ?? 14),
  elite:   +(process.env.TOPN_ELITE   ?? 20),
};

exports.handler = async (event) => {
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
    console.log('[IG] Starting queue processing…');
    const nowIso = new Date().toISOString();

    // 1) Pull a generous batch; enforce limits in code.
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
      .or(`(next_attempt_at.is.null,next_attempt_at.lte.${nowIso})`) // retry-ready or never scheduled
      .gte('clips.ai_score', 0.25) // wider candidate pool
      .order('ai_score', { ascending: false, foreignTable: 'clips' })
      .limit(200);

    if (error) throw error;

    const todayISO = new Date().toISOString().split('T')[0] + 'T00:00:00';

    // Per-run tracking (per-user, per-platform)
    const processedPlatformThisRun = new Map(); // key: `${userId}:instagram` -> count

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
        console.warn('[IG] getPostedSetForUser error', error);
      }
      const set = new Set((data || []).map(r => r.clip_id));
      postedClipIdsCache.set(userId, set);
      return set;
    }

    // 2) Process pending uploads, highest score first
    for (const upload of (pendingUploads || [])) {
      try {
        const userId = upload.clips.user_id;

        // User tier + threshold
        const { data: userProfile } = await supabase
          .from('user_profiles')
          .select('subscription_plan, viral_threshold')
          .eq('user_id', userId)
          .single();

        const tierRaw = (userProfile?.subscription_plan || 'starter').toLowerCase();
        const tier = ['starter','pro','elite'].includes(tierRaw)
          ? tierRaw
          : (tierRaw === 'enterprise' ? 'elite' : 'starter');

        const topNPerDay = TOPN[tier] ?? TOPN.starter;

        // Per-user viral threshold with 0.25–0.95 clamp
        const rawThreshold = Number(userProfile?.viral_threshold);
        const userThreshold = Math.min(0.95, Math.max(0.25, Number.isFinite(rawThreshold) ? rawThreshold : 0.25));
        if ((upload.clips.ai_score ?? 0) < userThreshold) {
          console.log(`[IG] Skip ${upload.clip_id}: score ${upload.clips.ai_score} < threshold ${userThreshold}`);
          continue;
        }

        // Unique-clip/day quota (cross-posting counts as 1)
        const postedSet = await getPostedSetForUser(userId);
        const uniqueDailyAllowance = topNPerDay;

        if (postedSet.size >= uniqueDailyAllowance && !postedSet.has(upload.clip_id)) {
          console.log(`[IG] Skip new clip ${upload.clip_id}: unique quota reached (${postedSet.size}/${uniqueDailyAllowance})`);
          continue;
        }

        // Per-platform daily cap (Instagram)
        const { count: platformPublishedToday } = await supabase
          .from('published_content')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('platform', PLATFORM)
          .gte('published_at', todayISO);

        const platformKey = `${userId}:${PLATFORM}`;
        const usedThisRun = processedPlatformThisRun.get(platformKey) || 0;
        const remainingPlatform = PLATFORM_DAILY_CAP - (platformPublishedToday || 0) - usedThisRun;

        if (remainingPlatform <= 0) {
          console.log(`[IG] Skip ${upload.clip_id}: platform cap reached (used=${platformPublishedToday || 0}, inRun=${usedThisRun}, cap=${PLATFORM_DAILY_CAP})`);
          continue;
        }

        // Mark attempt (optional)
        await supabase
          .from('publishing_queue')
          .update({
            status: 'pending', // keep status model
            attempts: (upload.attempts || 0) + 1
          })
          .eq('id', upload.id);

        // 3) Publish to Instagram (your existing function)
        const resp = await fetch(
          'https://beautiful-rugelach-bda4b4.netlify.app/.netlify/functions/post-to-instagram',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clipId: upload.clip_id })
          }
        );

        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${txt}`);
        }
        const json = await resp.json();
        if (!json.success) {
          throw new Error(json.error || 'Instagram publish failed');
        }

        // 4) Success bookkeeping
        await supabase
          .from('publishing_queue')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString()
          })
          .eq('id', upload.id);

        await supabase
          .from('published_content')
          .insert({
            clip_id: upload.clip_id,
            user_id: upload.clips.user_id,
            platform: PLATFORM,
            platform_post_id: json.mediaId || json.id || null,
            platform_url: json.permalink || null,
            published_at: new Date().toISOString(),
            last_metrics_update: new Date().toISOString(),
            metrics: {}
          });

        // Count platform usage for this run (so we don't exceed cap during this invocation)
        processedPlatformThisRun.set(platformKey, (processedPlatformThisRun.get(platformKey) || 0) + 1);

        // Count a UNIQUE clip only on the first successful publish of this clip today
        if (!postedSet.has(upload.clip_id)) {
          postedSet.add(upload.clip_id);
        }

        console.log(`[IG] Success clip ${upload.clip_id}`);
      } catch (e) {
        console.error(`[IG] Upload error for ${upload?.clip_id}:`, e.message);

        const attemptNo = (upload.attempts || 0) + 1;
        const backoffMins = [5, 15, 60, 180, 360]; // 5m, 15m, 1h, 3h, 6h
        const delayMin = backoffMins[Math.min(attemptNo - 1, backoffMins.length - 1)];
        const nextAttemptAt = new Date(Date.now() + delayMin * 60 * 1000).toISOString();

        await supabase
          .from('publishing_queue')
          .update({
            status: 'pending',           // stay pending; scheduler skips until next_attempt_at
            last_error: e.message,
            next_attempt_at: nextAttemptAt
            // attempts already incremented earlier in your "mark attempt" update
        })
          .eq('id', upload.id);
      }
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        processed: pendingUploads ? pendingUploads.length : 0,
        message: '[IG] Queue processed'
      })
    };
  } catch (err) {
    console.error('[IG] Fatal:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
