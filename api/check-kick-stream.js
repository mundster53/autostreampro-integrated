// api/check-kick-stream.js - Vercel Edge Function with debugging
export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');
  const debug = searchParams.get('debug') === 'true';
  
  if (!slug) {
    return new Response(JSON.stringify({ error: 'Missing slug parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const response = await fetch(`https://kick.com/${slug}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ 
        live: false, 
        error: `HTTP ${response.status}`,
        debug: debug ? { status: response.status } : undefined
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const html = await response.text();
    
    if (debug) {
      // Return snippet of HTML for debugging
      return new Response(JSON.stringify({
        htmlLength: html.length,
        snippet: html.substring(0, 500),
        hasPlaylistUrl: html.includes('playlist.live-video.net'),
        hasPlaybackUrl: html.includes('playback_url')
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Extract HLS URL
    const hlsMatch = html.match(/https:\/\/[a-z0-9]+\.playlist\.live-video\.net\/[^"'\s]+\.m3u8/);
    
    if (hlsMatch && hlsMatch[0]) {
      return new Response(JSON.stringify({
        live: true,
        hlsUrl: hlsMatch[0],
        ttlSeconds: 180
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ 
      live: false,
      htmlLength: html.length
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ 
      live: false, 
      error: error.message 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
