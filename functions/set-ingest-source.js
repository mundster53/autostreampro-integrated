// functions/set-ingest-source.js
// Drop-in: Sets KICK_CHANNEL for ingest service and restarts latest deployment.
// Requires env: RAILWAY_TOKEN (Team token), RAILWAY_PROJECT_ID, RAILWAY_INGEST_KICK_SERVICE_ID
// Optional: SUPABASE_URL, SUPABASE_SERVICE_KEY if you want to pass { userId } and look up the Kick handle.

const ENDPOINT = 'https://backboard.railway.com/graphql/v2'; // NOTE: .com (not .app)

// Small GQL helper
async function gql(query, variables = {}) {
  const token = process.env.RAILWAY_TOKEN;
  if (!token) throw new Error('Missing RAILWAY_TOKEN');
  const headers = {
    'Content-Type': 'application/json',
    // Support both styles per docs/guides
    'Authorization': `Bearer ${token}`,
    'Team-Access-Token': token,
  };
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) {
    throw new Error(`Railway HTTP ${res.status}: ${text}`);
  }
  if (json.errors && json.errors.length) {
    const msg = json.errors.map(e => e.message).join('; ');
    throw Object.assign(new Error(`Railway GQL: ${msg}`), { details: json.errors });
  }
  return json.data;
}

// Optional: look up active Kick handle for a user in Supabase
async function getKickHandleFromSupabase(userId) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  const url = `${SUPABASE_URL}/rest/v1/streaming_connections?user_id=eq.${encodeURIComponent(userId)}&platform=eq.kick&select=platform_user_id,is_active`;
  const r = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!r.ok) throw new Error(`Supabase HTTP ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  const active = rows.find(x => x.is_active) || rows[0];
  return active?.platform_user_id || null;
}

// Choose env id (prefer "production", else first)
function pickEnvId(project) {
  const envEdges = project?.environments?.edges || [];
  const byName = envEdges.find(e => e?.node?.name?.toLowerCase() === 'production');
  return (byName || envEdges[0])?.node?.id || null;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const {
      RAILWAY_PROJECT_ID,
      RAILWAY_INGEST_KICK_SERVICE_ID,
    } = process.env;

    if (!RAILWAY_PROJECT_ID || !RAILWAY_INGEST_KICK_SERVICE_ID) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Missing Railway IDs in env' }) };
    }

    // Parse input
    const body = JSON.parse(event.body || '{}');
    let handle = (body.platform_user_id || body.kickUsername || '').trim().toLowerCase();

    if (!handle && body.userId) {
      // Try Supabase lookup if userId provided and handle missing
      handle = (await getKickHandleFromSupabase(String(body.userId))) || '';
    }
    if (!handle) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing platform_user_id (Kick handle)' }) };
    }

    // 1) Fetch project -> get environments + confirm service exists
    const projData = await gql(`
      query($id:String!){
        project(id:$id){
          id name
          environments(first:50){ edges{ node{ id name } } }
          services(first:100){ edges{ node{ id name } } }
        }
      }`,
      { id: RAILWAY_PROJECT_ID }
    );

    const project = projData?.project;
    if (!project) throw new Error('Project not found or not authorized');

    const environmentId = pickEnvId(project);
    if (!environmentId) throw new Error('No environments found in project');

    const serviceId = RAILWAY_INGEST_KICK_SERVICE_ID;
    const hasService = project.services?.edges?.some(e => e?.node?.id === serviceId);
    if (!hasService) {
      throw new Error(`Service ${serviceId} not found in project`);
    }

    // 2) Upsert variable KICK_CHANNEL at service scope
    await gql(`
      mutation($input: VariableUpsertInput!){
        variableUpsert(input:$input)
      }`,
      {
        input: {
          projectId: RAILWAY_PROJECT_ID,
          environmentId,
          serviceId,
          name: 'KICK_CHANNEL',
          value: handle,
        }
      }
    );

    // 3) Get latest active deployment for that service+env, then restart it
    const depData = await gql(`
      query($input: DeploymentsInput!){
        deployments(first:1, input:$input){
          edges{ node{ id staticUrl } }
        }
      }`,
      {
        input: {
          projectId: RAILWAY_PROJECT_ID,
          environmentId,
          serviceId,
        }
      }
    );

    const depId = depData?.deployments?.edges?.[0]?.node?.id || null;
    if (depId) {
      await gql(`mutation($id:ID!){ deploymentRestart(id:$id) }`, { id: depId });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        message: `Ingest now set to ${handle}`,
        environmentId,
        restartedDeployment: !!depId,
      }),
    };
  } catch (err) {
    console.error('set-ingest-source error:', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err.message || err) }) };
  }
};
