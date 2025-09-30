// Overwrite the debug function
cat > functions/railway-debug.js <<'EOF'
// functions/railway-debug.js
const ENDPOINT = 'https://backboard.railway.app/graphql/v2'; // .app + /v2

exports.handler = async () => {
  const mask = v => (v ? `${String(v).slice(0,4)}…len${String(v).length}` : null);
  const out = {
    env: {
      has_TOKEN: !!process.env.RAILWAY_TOKEN,
      TOKEN_masked: mask(process.env.RAILWAY_TOKEN),
      has_PROJECT_ID: !!process.env.RAILWAY_PROJECT_ID,
      PROJECT_ID_masked: mask(process.env.RAILWAY_PROJECT_ID),
      has_SERVICE_ID: !!process.env.RAILWAY_INGEST_KICK_SERVICE_ID,
      SERVICE_ID_masked: mask(process.env.RAILWAY_INGEST_KICK_SERVICE_ID),
    },
    viewer: null,
    project: null,
    status: {}
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.RAILWAY_TOKEN || ''}`,
    'Team-Access-Token': process.env.RAILWAY_TOKEN || '',
  };

  try {
    // 1) viewer
    const v = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: 'query{ viewer { id } }' }),
    });
    out.status.viewerHTTP = v.status;
    out.status.viewerRaw = await v.text();
    try { out.viewer = JSON.parse(out.status.viewerRaw).data?.viewer || null; } catch {}

    // 2) project (prove team scope)
    if (process.env.RAILWAY_PROJECT_ID) {
      const p = await fetch(ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: 'query($id:String!){ project(id:$id){ id name services(first:5){ edges{ node{ id name } } } environments(first:5){ edges{ node{ id name } } } } }',
          variables: { id: process.env.RAILWAY_PROJECT_ID },
        }),
      });
      out.status.projectHTTP = p.status;
      out.status.projectRaw = await p.text();
      try { out.project = JSON.parse(out.status.projectRaw).data?.project || null; } catch {}
    }
  } catch (e) {
    out.status.error = String(e);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(out, null, 2),
  };
};
EOF
