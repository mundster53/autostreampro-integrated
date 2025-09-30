// netlify/functions/set-ingest-source.js
// Purpose: Look up the user's active Kick handle in Supabase, set Railway KICK_CHANNEL,
// and restart the ingest service.

import fetch from "node-fetch";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  RAILWAY_TOKEN,
  RAILWAY_PROJECT_ID,
  RAILWAY_INGEST_KICK_SERVICE_ID,
} = process.env;

const GQL = "https://backboard.railway.app/graphql";

async function gql(query, variables = {}) {
  const res = await fetch(GQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RAILWAY_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Railway GraphQL HTTP ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`Railway GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

async function getActiveKickHandleForUser(userId) {
  // SELECT platform_user_id FROM streaming_connections
  // WHERE platform='kick' AND is_active=true AND user_id=:userId LIMIT 1;
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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase HTTP ${res.status}: ${text}`);
  }
  const rows = await res.json();
  if (!rows?.length) return null;
  return rows[0].platform_user_id;
}

async function getFirstEnvironmentId(projectId) {
  const data = await gql(
    `
    query ProjectEnvironments($projectId: String!) {
      project(id: $projectId) {
        environments(first: 10) {
          edges { node { id name } }
        }
      }
    }
  `,
    { projectId }
  );

  const edges = data?.project?.environments?.edges ?? [];
  if (!edges.length) {
    throw new Error("No Railway environments found for the project.");
  }
  // Prefer "production" if present, otherwise first
  const prod = edges.find((e) => e.node.name?.toLowerCase() === "production");
  return (prod ?? edges[0]).node.id;
}

async function upsertKickChannelVar({ projectId, environmentId, serviceId, kickHandle }) {
  // Upsert variables at the service scope
  const data = await gql(
    `
    mutation VariableCollectionUpsert($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input) { id }
    }
  `,
    {
      input: {
        projectId,
        environmentId,
        serviceId,
        variables: [
          {
            name: "KICK_CHANNEL",
            value: kickHandle,
          },
        ],
      },
    }
  );
  return data?.variableCollectionUpsert?.id ?? null;
}

async function restartService({ serviceId, environmentId }) {
  const data = await gql(
    `
    mutation ServiceRedeploy($id: String!, $environmentId: String!) {
      serviceRedeploy(id: $id, environmentId: $environmentId) { id }
    }
  `,
    { id: serviceId, environmentId }
  );
  return data?.serviceRedeploy?.id ?? null;
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    // Body can be { userId } or { platform_user_id } to override lookup
    const { userId, platform_user_id } = JSON.parse(event.body || "{}");

    // Basic guardrails
    const missing = [];
    if (!SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!SUPABASE_SERVICE_KEY) missing.push("SUPABASE_SERVICE_KEY");
    if (!RAILWAY_TOKEN) missing.push("RAILWAY_TOKEN");
    if (!RAILWAY_PROJECT_ID) missing.push("RAILWAY_PROJECT_ID");
    if (!RAILWAY_INGEST_KICK_SERVICE_ID) missing.push("RAILWAY_INGEST_KICK_SERVICE_ID");
    if (missing.length) {
      return {
        statusCode: 500,
        body: `Missing required env vars: ${missing.join(", ")}`,
      };
    }

    let kickHandle = platform_user_id;
    if (!kickHandle) {
      if (!userId) {
        return {
          statusCode: 400,
          body: "Provide either platform_user_id or userId in the POST body.",
        };
      }
      kickHandle = await getActiveKickHandleForUser(userId);
    }

    if (!kickHandle) {
      return {
        statusCode: 404,
        body: "Active Kick connection not found for this user.",
      };
    }

    const environmentId = await getFirstEnvironmentId(RAILWAY_PROJECT_ID);

    await upsertKickChannelVar({
      projectId: RAILWAY_PROJECT_ID,
      environmentId,
      serviceId: RAILWAY_INGEST_KICK_SERVICE_ID,
      kickHandle,
    });

    await restartService({
      serviceId: RAILWAY_INGEST_KICK_SERVICE_ID,
      environmentId,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        message: `KICK_CHANNEL set to "${kickHandle}" and ingest restarted.`,
      }),
    };
  } catch (err) {
    // Return a concise error so you can see it in Netlify logs
    return {
      statusCode: 500,
      body: `Error: ${err.message}`,
    };
  }
};
