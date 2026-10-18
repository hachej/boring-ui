// Worker for test/packages/pi-storage-conformance.test.mjs: runs one case of Pi's storage conformance suite against Pi's own
// `openDurableObjectSqliteStorage` on a fresh SQLite-backed Durable Object in workerd (miniflare). Bundled by the test.
import { DurableObject } from 'cloudflare:workers';
import { createStorageConformance } from '@earendil-works/pi-durable/testing';
import { openDurableObjectSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/cloudflare';

const isObject = value => typeof value === 'object' && value !== null;
function equal(actual, expected, partial) {
  if (Object.is(actual, expected)) return true;
  if (!isObject(actual) || !isObject(expected) || Array.isArray(actual) !== Array.isArray(expected)) return false;
  if (actual instanceof Uint8Array || expected instanceof Uint8Array) return actual instanceof Uint8Array && expected instanceof Uint8Array && actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
  const keys = Object.keys(expected);
  if (!partial && (Array.isArray(actual) ? actual.length !== expected.length : Object.keys(actual).length !== keys.length)) return false;
  if (partial && Array.isArray(expected) && actual.length !== expected.length) return false;
  return keys.every(key => key in actual && equal(actual[key], expected[key], partial));
}
const fail = (message, actual, expected) => { throw new Error(`${message}\nactual: ${JSON.stringify(actual, (_k, v) => typeof v === 'bigint' ? `${v}n` : v)}\nexpected: ${JSON.stringify(expected, (_k, v) => typeof v === 'bigint' ? `${v}n` : v)}`); };
const assertions = {
  ok: (value, message) => { if (!value) fail(message ?? 'expected a truthy value', value, true); },
  strictEqual: (actual, expected) => { if (!Object.is(actual, expected)) fail('strictEqual', actual, expected); },
  deepEqual: (actual, expected) => { if (!equal(actual, expected, false)) fail('deepEqual', actual, expected); },
  partialDeepEqual: (actual, expected) => { if (!equal(actual, expected, true)) fail('partialDeepEqual', actual, expected); },
  greaterThan: (actual, expected) => { if (!(actual > expected)) fail('greaterThan', actual, expected); },
  rejects: async (operation, messageIncludes) => {
    const error = await operation.then(() => undefined, caught => caught ?? new Error('rejected'));
    if (error === undefined) fail('expected a rejection', 'resolved', messageIncludes);
    if (!String(error?.message).includes(messageIncludes)) fail('rejection message', String(error?.message), messageIncludes);
  },
};

const casesFor = withStorage => createStorageConformance({ assertions, withStorage });

export class Conformance extends DurableObject {
  async run(name) {
    const entry = casesFor(async use => use(await openDurableObjectSqliteStorage(this.ctx.storage))).find(candidate => candidate.name === name);
    if (!entry) return { ok: false, error: `unknown case ${name}` };
    try { await entry.run(); return { ok: true }; } catch (error) { return { ok: false, error: String(error?.stack ?? error) }; }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/cases') return Response.json(casesFor(async () => {}).map(entry => entry.name));
    // A fresh object, so every case starts on an empty database.
    const stub = env.CONFORMANCE.get(env.CONFORMANCE.newUniqueId());
    return Response.json(await stub.run(url.searchParams.get('case')));
  },
};
