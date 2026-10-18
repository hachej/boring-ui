// The Worker: bearer-token check, then everything under /api goes to the one Durable Object. Static files are served by the
// assets binding without running this code.
export { Assistant } from './assistant.mjs';

const encoder = new TextEncoder();

/** Constant-time comparison of the presented token with the Worker secret (compared as SHA-256 digests of equal length). */
async function authorized(request, env) {
  const header = request.headers.get('authorization') ?? '';
  // A browser cannot set headers on a WebSocket: the chat socket offers the token as the subprotocol `bearer.<token>` beside `boring.chat`.
  const offered = request.headers.get('upgrade')?.toLowerCase() === 'websocket'
    ? (request.headers.get('sec-websocket-protocol') ?? '').split(',').map(value => value.trim()).find(value => value.startsWith('bearer.'))?.slice(7) : undefined;
  const presented = header.startsWith('Bearer ') ? header.slice(7) : offered ?? '';
  if (!presented || !env.ACCESS_TOKEN) return false;
  const [a, b] = await Promise.all([presented, env.ACCESS_TOKEN].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  return crypto.subtle.timingSafeEqual(a, b);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!await authorized(request, env)) {
      return Response.json({ reason: 'authentication-required' }, { status: 401, headers: { 'www-authenticate': 'Bearer', 'cache-control': 'no-store' } });
    }
    return env.ASSISTANT.getByName('main').fetch(request);
  },
};
