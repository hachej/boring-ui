import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemoteShellHandler, createRemoteShellLease } from '@hachej/boring-execution/remote-shell';
import { createRemoteFileSystemHandler, createRemoteFileSystemLease } from '@hachej/boring-execution/remote-files';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { getOrThrow } from '@earendil-works/pi-durable/env';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';

// The Cloudflare Workers runtime refuses redirect:"error" ("Invalid redirect value, must be one of follow or manual").
// This fetch behaves the same way, then hands the request to the real handler.
const workerFetch = handler => async request => {
  if (request.redirect !== 'follow' && request.redirect !== 'manual') throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
  return handler(request);
};
const redirecting = calls => async request => {
  calls.push(request.url);
  return new Response(null, { status: 302, headers: { location: 'https://elsewhere.invalid/steal' } });
};
const identity = { providerId: 'fictional-worker', instanceId: 'machine-1', incarnation: 'generation-1', viewId: 'working-1' };
const endpoint = 'https://fictional.invalid/remote';

test('The remote shell and files clients run on a fetch that refuses redirect:error, and refuse a redirect', { timeout: 10000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'boring-remote-worker-'));
  const native = new NodeExecutionEnv({ cwd: directory, shellPath: '/bin/bash', shellEnv: { PATH: '/usr/bin:/bin' } });
  t.after(async () => { await native.cleanup(context); await rm(directory, { recursive: true, force: true }); });
  await writeFile(join(directory, 'a.txt'), 'hello');
  const revoked = new AbortController();
  const shellAccess = { identity, context, revoked: revoked.signal, supports: { timeout: true, spill: true }, authorize: () => true, shell: native, cleanup: async () => {} };
  const filesAccess = {
    identity, filesystemId: native.id, context, revoked: revoked.signal, authorize: () => true,
    bindFileSystem: async () => ({ identity, environment: native, ownership: 'borrowed', release: async () => {} }),
  };
  const shellHandler = createRemoteShellHandler({ authenticate: async () => shellAccess });
  const filesHandler = createRemoteFileSystemHandler({ authenticate: async () => filesAccess });

  const shell = createRemoteShellLease({ identity, endpoint, fetch: workerFetch(shellHandler) });
  const files = createRemoteFileSystemLease({ identity, filesystemId: native.id, cwd: directory, endpoint, fetch: workerFetch(filesHandler) });
  t.after(async () => { await shell.release(context); await files.release(context); });
  let out = '';
  const ran = await shell.environment.exec('echo worker', { onOutput: text => { out += text; } }, context);
  assert.equal(getOrThrow(ran).exitCode, 0);
  assert.equal(out.trim(), 'worker');
  assert.equal(await getOrThrow(await files.environment.readTextFile('a.txt', context)), 'hello');

  const shellCalls = [], fileCalls = [];
  const shellRedirected = createRemoteShellLease({ identity, endpoint, fetch: redirecting(shellCalls) });
  const filesRedirected = createRemoteFileSystemLease({ identity, filesystemId: native.id, cwd: directory, endpoint, fetch: redirecting(fileCalls) });
  t.after(async () => { await shellRedirected.release(context); await filesRedirected.release(context); });
  const refusedShell = await shellRedirected.environment.exec('echo no', undefined, context);
  assert.equal(refusedShell.ok, false);
  assert.equal(refusedShell.error.code, 'unknown');
  const refusedFile = await filesRedirected.environment.readTextFile('a.txt', context);
  assert.equal(refusedFile.ok, false);
  assert.deepEqual([shellCalls.length, fileCalls.length], [1, 1]);
});
