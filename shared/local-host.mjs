// Host code for the local dev/example servers (127.0.0.1, bearer token often inlined in the page). Two small guards.
import { timingSafeEqual } from 'node:crypto';

/** DNS rebinding guard: answers 421 and returns true unless Host names 127.0.0.1, localhost or `insecure.test` (any port, so a local proxy in front still works). Call first in the request handler. */
export function rejectForeignHost(incoming, outgoing) {
  // `insecure.test` is the browser journeys' non-secure-context name for 127.0.0.1 (@hachej/boring-testing insecureUrl); `.test` never resolves in public DNS.
  if (/^(127\.0\.0\.1|localhost|insecure\.test)(:\d+)?$/.test(incoming.headers.host ?? '')) return false;
  outgoing.writeHead(421, { 'content-type': 'text/plain; charset=utf-8' }).end('Misdirected request: this server answers only on 127.0.0.1 or localhost.');
  return true;
}

/** Constant-time string equality (false on a missing value or length mismatch), for bearer comparisons. */
export function sameSecret(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
