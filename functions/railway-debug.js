// functions/railway-debug.js
const ENDPOINT = 'https://backboard.railway.com/graphql/v2';

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

  try {
    // 1) viewer
    const v = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RAILWAY_TOKEN}`,
      },
      body: JSON.stringify({ query: 'query{ viewer { id } }' }),
    });
    out.status.viewerHTTP = v.status;
    const vtxt = await v.text();
    try { out.viewer = JSON.parse(vtxt).data?.viewer || null; }
    catch { out.status.viewerBody = vtxt; }

    // 2) project (proves token’s team scope)
    if (process.env.RAILWAY_PROJECT_ID) {
      const p = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.RAILWAY_TOKEN}`,
        },
        body: JSON.stringify({
          query: 'query($id:String!){ project(id:$id){ id name services(first:5){ edges{ node{ id name } } } environments(first:5){ edges{ node{ id name } } } } }',
          variables: { id: process.env.RAILWAY_PROJECT_ID },
        }),
      });
      out.status.projectHTTP = p.status;
      const ptxt = await p.text();
      try { out.project = JSON.parse(ptxt).data?.project || null; }
      catch { out.status.projectBody = ptxt; }
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
