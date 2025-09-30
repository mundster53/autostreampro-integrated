// functions/set-ingest-source.js
// Permanent, hardened version. Server-only, idempotent, retries, and scope checks.
// Requires env: RAILWAY_TOKEN (Team token), RAILWAY_PROJECT_ID, RAILWAY_INGEST_KICK_SERVICE_ID
// Optional for userId lookup: SUPABASE_URL, SUPABASE_SERVICE_KEY
// Optional hardening: ADMIN_SECRET (if set, requests must include header x-admin-secret that matches)

const ENDPOINT = 'https://backboard.railway.app/graphql/v2'; // canonical public API

// ── utils ────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const isUUID = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s||''));
const mask = (v) => v ? `${String(v).slice(0,4)}…len${String(v).length}` : null;

function envOrThrow() {
  const {
    RAILWAY_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_INGEST_KICK_SERVICE_ID,
    SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_SECRET
  } = process.env;

  const missing = [];
  if (!RAILWAY_TOKEN) missing.push('RAILWAY_TOKEN');
  if (!RAILWAY_PROJECT_ID) missing.push('RAILWAY_PROJECT_ID');
  if (!RAILWAY_INGEST_KICK_SERVICE_ID) missing.push('RAILWAY_INGEST_KICK_SERVICE_ID');
  if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);

  if (!isUUID(RAILWAY_PROJECT_ID)) throw new Error('RAILWAY_PROJECT_ID must be a UUID');
  if (!isUUID(RAILWAY_INGEST_KICK_SERVICE_ID)) throw new Error('RAILWAY_INGEST_KICK_SERVICE_ID must be a UUID');

  return { RAILWAY_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_INGEST_KICK_SERVICE_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_SECRET };
}

async function gql(token, query, variables = {}, attempt = 1) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const txt = await res.text();
  let json;
  try { json = JSON.parse(txt); } catch { json = null; }
  if (!res.ok || (json && json.errors && json.errors.length)) {
    const msg = json?.errors?.map(e => e.message).join('; ') || `HTTP ${res.status}: ${txt}`;
    // Retry on transient problems
    if (attempt < 3 && /Problem processing request|timeout|502|503|504/i.test(msg)) {
      await sleep(250 * attempt);
      return gql(token, query, variables, attempt + 1);
    }
    const err = new Error(`Railway GQL: ${msg}`);
    err.status = res.status; err.raw = txt;
    throw err;
  }
  return json.data;
}

function pickEnvId(project) {
  const edges = project?.environments?.edges || [];
  const prod = edges.find(e => e?.node?.name?.toLowerCase() === 'production');
  return (prod ?? edges[0])?.node?.id || null;
}

async function getHandleFromSupabase(userId, SUPABASE_URL, SUPABASE_SERVICE_KEY) {
  if (!userId || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  const url = `${SUPABASE_URL}/rest/v1/streaming_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.kick&select=platform_user_id,is_active&order=is_active.desc`;
  const r = await fetch(url, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } });
  if (!r.ok) throw new Error(`Supabase HTTP ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  const active = rows.find(x => x.is_active) || rows[0];
  return active?.platform_user_id?.toLowerCase() || null;
}

// ── main handler ────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const { ADMIN_SECRET, RAILWAY_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_INGEST_KICK_SERVICE_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY } = envOrThrow();

    // Optional lock: require admin secret if configured
    if (ADMIN_SECRET) {
      const provided = event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'];
      if (provided !== ADMIN_SECRET) return { statusCode: 401, body: 'Unauthorized' };
    }

    const body = JSON.parse(event.body || '{}');
    let handle = String(body.platform_user_id || body.kickUsername || '').trim().toLowerCase();
    if (!handle && body.userId) handle = await getHandleFromSupabase(String(body.userId), SUPABASE_URL, SUPABASE_SERVICE_KEY);
    if (!handle) return { statusCode: 400, body: JSON.stringify({ ok:false, error: 'Provide platform_user_id OR userId with a saved Kick connection' }) };

    // 1) Verify token can see project + get env + service presence
    const proj = await gql(RAILWAY_TOKEN, `
      query($id:String!){
        project(id:$id){
          id name
          services(first:100){ edges{ node{ id name } } }
          environments(first:20){ edges{ node{ id name } } }
        }
      }`, { id: RAILWAY_PROJECT_ID });

    if (!proj?.project) return { statusCode: 403, body: JSON.stringify({ ok:false, error: 'Not Authorized for this project (check Team token + project id)' }) };

    const envId = pickEnvId(proj.project);
    if (!envId) throw new Error('No environments found in project');
    const serviceExists = proj.project.services?.edges?.some(e => e?.node?.id === RAILWAY_INGEST_KICK_SERVICE_ID);
    if (!serviceExists) return { statusCode: 400, body: JSON.stringify({ ok:false, error: 'Service id not found in project. Double-check RAILWAY_INGEST_KICK_SERVICE_ID.' }) };

    // 2) Check if current variable already equals desired handle (idempotent)
    const vars = await gql(RAILWAY_TOKEN, `
      query($pid:String!, $eid:String!, $sid:String!){
        variables(projectId:$pid, environmentId:$eid, serviceId:$sid){
          edges{ node{ id name value } }
        }
      }`, { pid: RAILWAY_PROJECT_ID, eid: envId, sid: RAILWAY_INGEST_KICK_SERVICE_ID });

    const current = (vars?.variables?.edges || [])
      .map(e => e?.node)
      .find(v => v?.name === 'KICK_CHANNEL')?.value?.toLowerCase();

    if (current === handle) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok:true, message: `KICK_CHANNEL already ${handle}; no restart`, environmentId: envId, restartedDeployment: false }),
      };
    }

    // 3) Upsert KICK_CHANNEL
    await gql(RAILWAY_TOKEN, `
      mutation($input:VariableUpsertInput!){
        variableUpsert(input:$input)
      }`, {
      input: {
        projectId: RAILWAY_PROJECT_ID,
        environmentId: envId,
        serviceId: RAILWAY_INGEST_KICK_SERVICE_ID,
        name: 'KICK_CHANNEL',
        value: handle
      }
    });

    // 4) Restart latest deployment (if any)
    const deps = await gql(RAILWAY_TOKEN, `
      query($input:DeploymentsInput!){
        deployments(first:1, input:$input){ edges{ node{ id } } }
      }`, { input: { projectId: RAILWAY_PROJECT_ID, environmentId: envId, serviceId: RAILWAY_INGEST_KICK_SERVICE_ID } });

    const depId = deps?.deployments?.edges?.[0]?.node?.id;
    if (depId) await gql(RAILWAY_TOKEN, `mutation($id:ID!){ deploymentRestart(id:$id) }`, { id: depId });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok:true, message:`Ingest now set to ${handle}`, environmentId: envId, restartedDeployment: !!depId }),
    };
  } catch (e) {
    console.error('set-ingest-source error:', { msg: e.message, status: e.status, raw: e.raw });
    return { statusCode: 500, body: JSON.stringify({ ok:false, error: e.message }) };
  }
};
