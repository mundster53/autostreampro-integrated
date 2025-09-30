// POST /.netlify/functions/set-ingest-source
// Looks up the active Kick handle for this user in Supabase,
// sets Railway KICK_CHANNEL, and redeploys the ingest service.

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  RAILWAY_TOKEN,
  RAILWAY_PROJECT_ID,
  RAILWAY_INGEST_KICK_SERVICE_ID,
} = process.env;

const GQL_V2 = "https://backboard.railway.app/graphql/v2";
const GQL_V1 = "https://backboard.railway.app/graphql";

async function gqlWithFallback(query, variables = {}) {
  for (const endpoint of [GQL_V2, GQL_V1]) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RAILWAY_TOKEN}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 404) continue; // try next endpoint
    if (!res.ok) throw new Error(`Railway HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(`Railway GQL: ${JSON.stringify(json.errors)}`);
    return json.data;
  }
  throw new Error("Railway endpoint not found (v2 and v1 both 404).");
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

async function getFirstEnvironmentId(projectId) {
  const data = await gqlWithFallback(
    `query ($projectId: String!) {
      project(id: $projectId) {
        environments(first: 10) { edges { node { id name } } }
      }
    }`,
    { projectId }
  );
  const edges = data?.project?.environments?.edges ?? [];
  if (!edges.length) throw new Error("No Railway environments found.");
  const prod = edges.find((e) => e.node.name?.toLowerCase() === "production");
  return (prod ?? edges[0]).node.id;
}

async function upsertKickChannelVar({ projectId, environmentId, serviceId, kickHandle }) {
  await gqlWithFallback(
    `mutation ($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input) { id }
    }`,
    {
      input: {
        projectId,
        environmentId,
        serviceId,
        variables: [{ name: "KICK_CHANNEL", value: kickHandle }],
      },
    }
  );
}

async function restartService({ serviceId, environmentId }) {
  await gqlWithFallback(
    `mutation ($id: String!, $environmentId: String!) {
      serviceRedeploy(id: $id, environmentId: $environmentId) { id }
    }`,
    { id: serviceId, environmentId }
  );
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    const { userId, platform_user_id } = JSON.parse(event.body || "{}");

    const missing = [];
    if (!SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!SUPABASE_SERVICE_KEY) missing.push("SUPABASE_SERVICE_KEY");
    if (!RAILWAY_TOKEN) missing.push("RAILWAY_TOKEN");
    if (!RAILWAY_PROJECT_ID) missing.push("RAILWAY_PROJECT_ID");
    if (!RAILWAY_INGEST_KICK_SERVICE_ID) missing.push("RAILWAY_INGEST_KICK_SERVICE_ID");
    if (missing.length) return { statusCode: 500, body: `Missing env: ${missing.join(", ")}` };

    // Normal path (Option A): use userId -> lookup handle in DB
    let kickHandle = platform_user_id;
    if (!kickHandle) {
      if (!userId) return { statusCode: 400, body: "Provide userId or platform_user_id" };
      kickHandle = await getActiveKickHandleForUser(userId);
      if (!kickHandle) return { statusCode: 404, body: "No active Kick handle for this user" };
    }

    const environmentId = await getFirstEnvironmentId(RAILWAY_PROJECT_ID);
    await upsertKickChannelVar({
      projectId: RAILWAY_PROJECT_ID,
      environmentId,
      serviceId: RAILWAY_INGEST_KICK_SERVICE_ID,
      kickHandle,
    });
    await restartService({ serviceId: RAILWAY_INGEST_KICK_SERVICE_ID, environmentId });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, message: `Ingest now set to ${kickHandle}` }),
    };
  } catch (err) {
    return { statusCode: 500, body: `Error: ${err.message}` };
  }
};
