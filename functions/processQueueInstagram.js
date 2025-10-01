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

    // Pull a generous batch; enforce limits in code.
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
      .gte('clips.ai_score', 0.40)
      .order('ai_score', { ascending: false, foreignTable: 'clips' })
      .limit(200);

    if (error) throw error;

    const processedThisRun = new Map();
    const todayISO = new Date().toISOString().split('T')[0] + 'T00:00:00';

    for (const upload of (pendingUploads || [])) {
      try {
        const userId = upload.clips.user_id;

        // Get user's tier
        const { data: userProfile } = await supabase
          .from('user_profiles')
          .select('subscription_plan')
          .eq('user_id', userId)
          .single();

        const tierRaw = (userProfile?.subscription_plan || 'starter').toLowerCase();
        const tier = ['starter','pro','elite'].includes(tierRaw)
          ? tierRaw
          : (tierRaw === 'enterprise' ? 'elite' : 'starter');

        const topNPerDay = TOPN[tier] ?? TOPN.starter;

        // Already published today on Instagram? (use published_content as source of truth)
        const { count: publishedToday } = await supabase
          .from('published_content')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('platform', PLATFORM)
          .gte('published_at', todayISO);

        const alreadyThisRun = processedThisRun.get(userId) || 0;
        const dailyAllowance = Math.min(topNPerDay, PLATFORM_DAILY_CAP);
        const remaining = dailyAllowance - (publishedToday || 0) - alreadyThisRun;

        if (remaining <= 0) {
          console.log(`[IG] Skip ${upload.clip_id}: user ${userId} out of slots (tier=${tier})`);
          continue;
        }

        processedThisRun.set(userId, alreadyThisRun + 1);

        // Optional: reflect attempt
        await supabase
          .from('publishing_queue')
          .update({
            status: 'pending',
            attempts: (upload.attempts || 0) + 1
          })
          .eq('id', upload.id);

        // Call your Instagram publisher
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

        // Mark queue item completed
        await supabase
          .from('publishing_queue')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString()
          })
          .eq('id', upload.id);

        // Record in published_content
        await supabase
          .from('published_content')
          .insert({
            clip_id: upload.clip_id,
            platform: PLATFORM,
            platform_post_id: json.mediaId || json.id || null,
            platform_url: json.permalink || null,
            published_at: new Date().toISOString(),
            last_metrics_update: new Date().toISOString(),
            metrics: {}
          });

        console.log(`[IG] Success clip ${upload.clip_id}`);

      } catch (e) {
        console.error(`[IG] Upload error for ${upload?.clip_id}:`, e.message);
        await supabase
          .from('publishing_queue')
          .update({
            status: 'failed',
            last_error: e.message
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
