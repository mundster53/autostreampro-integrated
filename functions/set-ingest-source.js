// functions/set-ingest-source.js
// POST /.netlify/functions/set-ingest-source
// Input: { userId }  -> looks up active Kick handle in Supabase
//     or { platform_user_id } -> bypass lookup for a one-off test
//
// Sets Railway env KICK_CHANNEL via variableUpsert and restarts the latest deployment.

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  RAILWAY_TOKEN,
  RAILWAY_PROJECT_ID,
  RAILWAY_INGEST_KICK_SERVICE_ID,
} = process.env;

const GQLS = ["https://backboard.railway.app/graphql/v2", "https://backboard.railway.app/graphql"]; // v2 first

async function gql(query, variables = {}) {
  let lastErr;
  for (const endpoint of GQLS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RAILWAY_TOKEN}`,
        },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Railway HTTP ${res.status}: ${text}`);
      }
      const json = await res.json();
      if (json.errors?.length) {
        throw new Error(`Railway GQL: ${JSON.stringify(json.errors)}`);
      }
      return json.data;
    } catch (e) {
      lastErr = e;
      // fall through and try the next endpoint
    }
  }
  throw lastErr;
}

async function getActiveKickHandleForUser(userId) {
  const url = `${SUPABASE_URL}/rest/v1/streaming_connections?select=platform_user_id&platform=eq.kick&is_active=eq.true&user_id=eq.${encodeURIComponent(
    userId
  )}&limit=1`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Supabase HTTP ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows?.[0]?.platform_user_id ?? null;
}

// Prefer the "production" environment; otherwise use the first one.
async function getEnvironmentId(projectId) {
  const data = await gql(
    `query ($id: String!) {
      project(id: $id) {
        environments(first: 20) { edges { node { id name } } }
      }
    }`,
    { id: projectId }
  );
  const edges = data?.project?.environments?.edges ?? [];
  if (!edges.length) throw new Error("No Railway environments found for this project.");
  const prod = edges.find(e => e.node?.name?.toLowerCase() === "production");
  return (prod ?? edges[0]).node.id;
}

// Upsert env var with current API (variableUpsert)
async function upsertKickChannelVar({ projectId, environmentId, serviceId, kickHandle }) {
  await gql(
    `mutation ($input: VariableUpsertInput!) {
      variableUpsert(input: $input)
    }`,
    {
      input: {
        projectId,
        environmentId,
        serviceId,
        name: "KICK_CHANNEL",
        value: kickHandle,
      },
    }
  );
}

// Fetch latest deployment id for this service/env, then restart it.
async function restartLatestDeployment({ projectId, environmentId, serviceId }) {
  const data = await gql(
    `query ($input: DeploymentsInput!, $first: Int!) {
      deployments(first: $first, input: $input) {
        edges { node { id } }
      }
    }`,
    { input: { projectId, environmentId, serviceId }, first: 1 }
  );
  const depId = data?.deployments?.edges?.[0]?.node?.id;
  if (!depId) throw new Error("No deployments found to restart for this service/environment.");
  await gql(
    `mutation ($id: String!) {
      deploymentRestart(id: $id)
    }`,
    { id: depId }
  );
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const missing = [];
    if (!SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!SUPABASE_SERVICE_KEY) missing.push("SUPABASE_SERVICE_KEY");
    if (!RAILWAY_TOKEN) missing.push("RAILWAY_TOKEN");
    if (!RAILWAY_PROJECT_ID) missing.push("RAILWAY_PROJECT_ID");
    if (!RAILWAY_INGEST_KICK_SERVICE_ID) missing.push("RAILWAY_INGEST_KICK_SERVICE_ID");
    if (missing.length) {
      return { statusCode: 500, body: `Missing env: ${missing.join(", ")}` };
    }

    const { userId, platform_user_id } = JSON.parse(event.body || "{}");

    let kickHandle = platform_user_id;
    if (!kickHandle) {
      if (!userId) return { statusCode: 400, body: "Provide userId or platform_user_id" };
      kickHandle = await getActiveKickHandleForUser(userId);
      if (!kickHandle) return { statusCode: 404, body: "No active Kick handle for this user" };
    }

    const environmentId = await getEnvironmentId(RAILWAY_PROJECT_ID);
    await upsertKickChannelVar({
      projectId: RAILWAY_PROJECT_ID,
      environmentId,
      serviceId: RAILWAY_INGEST_KICK_SERVICE_ID,
      kickHandle,
    });

    await restartLatestDeployment({
      projectId: RAILWAY_PROJECT_ID,
      environmentId,
      serviceId: RAILWAY_INGEST_KICK_SERVICE_ID,
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, message: `Ingest now set to ${kickHandle}` }),
    };
  } catch (err) {
    return { statusCode: 500, body: `Error: ${err.message}` };
  }
};
