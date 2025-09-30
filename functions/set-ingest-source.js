// POST /.netlify/functions/set-ingest-source
// Input: { userId } OR { platform_user_id }
// Sets Railway env KICK_CHANNEL via variableUpsert and restarts latest deployment.

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  RAILWAY_TOKEN,
  RAILWAY_PROJECT_ID,
  RAILWAY_INGEST_KICK_SERVICE_ID,
} = process.env;

const GQL_ENDPOINT = "https://backboard.railway.app/graphql/v2";

async function gql(query, variables = {}) {
  const res = await fetch(GQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RAILWAY_TOKEN}` },
    body: JSON.stringify({ query, variables }),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Railway HTTP ${res.status}: ${txt}`);
  const json = JSON.parse(txt);
  if (json.errors?.length) throw new Error(`Railway GQL: ${JSON.stringify(json.errors)}`);
  return json.data;
}

async function getActiveKickHandleForUser(userId) {
  const url = `${SUPABASE_URL}/rest/v1/streaming_connections?select=platform_user_id&platform=eq.kick&is_active=eq.true&user_id=eq.${encodeURIComponent(userId)}&limit=1`;
  const r = await fetch(url, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }});
  if (!r.ok) throw new Error(`Supabase HTTP ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  return rows?.[0]?.platform_user_id ?? null;
}

async function getEnvironmentId(projectId) {
  const data = await gql(
    `query ($id:String!){
      project(id:$id){ environments(first:20){ edges{ node{ id name } } } }
    }`, { id: projectId }
  );
  const edges = data?.project?.environments?.edges ?? [];
  if (!edges.length) throw new Error("No Railway environments found.");
  const prod = edges.find(e => e.node?.name?.toLowerCase() === "production");
  return (prod ?? edges[0]).node.id;
}

async function upsertKickChannelVar({ projectId, environmentId, serviceId, kickHandle }) {
  await gql(
    `mutation ($input:VariableUpsertInput!){
      variableUpsert(input:$input)
    }`,
    { input: { projectId, environmentId, serviceId, name: "KICK_CHANNEL", value: kickHandle } }
  );
}

async function restartLatestDeployment({ projectId, environmentId, serviceId }) {
  const data = await gql(
    `query ($input:DeploymentsInput!, $first:Int!){
      deployments(first:$first, input:$input){ edges{ node{ id } } }
    }`,
    { first: 1, input: { projectId, environmentId, serviceId } }
  );
  const depId = data?.deployments?.edges?.[0]?.node?.id;
  if (!depId) throw new Error("No deployments found to restart.");
  await gql(`mutation ($id:String!){ deploymentRestart(id:$id) }`, { id: depId });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    const missing = [];
    for (const [k,v] of Object.entries({
      SUPABASE_URL, SUPABASE_SERVICE_KEY, RAILWAY_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_INGEST_KICK_SERVICE_ID
    })) if (!v) missing.push(k);
    if (missing.length) return { statusCode: 500, body: `Missing env: ${missing.join(", ")}` };

    const { userId, platform_user_id } = JSON.parse(event.body || "{}");
    let handle = platform_user_id;

    if (!handle) {
      if (!userId) return { statusCode: 400, body: "Provide userId or platform_user_id" };
      handle = await getActiveKickHandleForUser(userId);
      if (!handle) return { statusCode: 404, body: "No active Kick handle for this user" };
    }

    const environmentId = await getEnvironmentId(RAILWAY_PROJECT_ID);
    await upsertKickChannelVar({
      projectId: RAILWAY_PROJECT_ID,
      environmentId,
      serviceId: RAILWAY_INGEST_KICK_SERVICE_ID,
      kickHandle: handle,
    });
    await restartLatestDeployment({
      projectId: RAILWAY_PROJECT_ID,
      environmentId,
      serviceId: RAILWAY_INGEST_KICK_SERVICE_ID,
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, message: `Ingest now set to ${handle}` }),
    };
  } catch (e) {
    return { statusCode: 500, body: `Error: ${e.message}` };
  }
};
