// Cloudflare Pages → Netlify-like event adapter
// Polyfill: expose Cloudflare env bindings to Netlify-style code as process.env
if (!globalThis.process) globalThis.process = { env: {} };
export function _mergeEnvIntoProcess(env) { Object.assign(globalThis.process.env, env || {}); }

export function cfToNetlifyEvent(ctx) {
  const url = new URL(ctx.request.url);
  return {
    httpMethod: ctx.request.method,
    headers: Object.fromEntries(ctx.request.headers),
    rawUrl: ctx.request.url,
    queryStringParameters: Object.fromEntries(url.searchParams),
    body: null, // filled below for non-GET methods
  };
}

export async function runNetlifyHandler(handler, ctx) {
// ensure process.env has Cloudflare bindings
_mergeEnvIntoProcess(ctx.env);

  const event = cfToNetlifyEvent(ctx);

  // Only read body for non-GET/HEAD
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
    event.body = await ctx.request.text();
  }

  const result = await handler(event);
  const status  = result?.statusCode ?? 200;
  const headers = result?.headers ?? {};
  const body    = result?.body ?? '';

  return new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    { status, headers }
  );
}
