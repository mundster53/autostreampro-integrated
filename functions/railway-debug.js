// functions/railway-debug.js
exports.handler = async () => {
  const out = { endpoints: {}, project: null, services: null, envs: null, errors: [] };
  const eps = [
    "https://backboard.railway.app/graphql/v2",
    "https://backboard.railway.app/graphql",
    "https://backbone.railway.app/graphql/v2",
  ];
  const token = process.env.RAILWAY_TOKEN;
  const pid = process.env.RAILWAY_PROJECT_ID;
  const sid = process.env.RAILWAY_INGEST_KICK_SERVICE_ID;

  async function tryEp(url, q, v) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: q, variables: v || {} }),
      });
      out.endpoints[url] = { status: r.status, ok: r.ok };
      if (!r.ok) { out.endpoints[url].body = await r.text(); return null; }
      const j = await r.json();
      if (j.errors) out.endpoints[url].errors = j.errors;
      return j.data;
    } catch (e) {
      out.endpoints[url] = { error: String(e) };
      return null;
    }
  }

  const basicQ = "query{ viewer { id } }";
  for (const ep of eps) await tryEp(ep, basicQ);

  // Use first working endpoint to fetch project/services/environments
  const good = eps.find(e => out.endpoints[e]?.ok);
  if (good && pid) {
    const data = await tryEp(good, `query($id:String!){
      project(id:$id){
        id name
        services(first:100){ edges{ node{ id name } } }
        environments(first:20){ edges{ node{ id name } } }
      }
    }`, { id: pid });
    out.project = data?.project || null;
    out.services = data?.project?.services || null;
    out.envs = data?.project?.environments || null;

    // Hint checks
    if (sid && out.services) {
      const found = (out.services.edges||[]).some(e => e.node?.id === sid);
      if (!found) out.errors.push("Service ID not found in this project.");
    }
  }

  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(out, null, 2) };
};
