// Host code for the local dev/example servers (127.0.0.1, bearer token often inlined in the page). Two small guards.
import { timingSafeEqual } from 'node:crypto';

/** DNS rebinding guard: answers 421 and returns true unless Host is `127.0.0.1:<bound port>` or `localhost:<bound port>`. Call first in the request handler. */
export function rejectForeignHost(incoming, outgoing) {
  const port = incoming.socket.localPort, host = incoming.headers.host;
  if (host === `127.0.0.1:${port}` || host === `localhost:${port}`) return false;
  outgoing.writeHead(421, { 'content-type': 'text/plain; charset=utf-8' }).end('Misdirected request: this server answers only on 127.0.0.1 or localhost.');
  return true;
}

/** Constant-time string equality (false on a missing value or length mismatch), for bearer comparisons. */
export function sameSecret(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
