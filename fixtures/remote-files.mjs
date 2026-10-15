import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemoteFileSystemHandler, createRemoteFileSystemLease } from '@hachej/boring-execution/remote-files';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { getOrThrow } from '@earendil-works/pi-durable/env';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';

const directory = await mkdtemp(join(tmpdir(), 'fictional-remote-files-'));
const native = new NodeExecutionEnv({ cwd: directory });
const identity = { providerId: 'fictional', instanceId: 'one', incarnation: 'one', viewId: 'working' };
const revoked = new AbortController();
let released = 0;
const handler = createRemoteFileSystemHandler({ authenticate: async () => ({
  identity, filesystemId: native.id, context, revoked: revoked.signal,
  authorize: (call, cwd) => cwd === directory && call.args[0] === 'note.txt'
    && ['writeFile', 'openTextLineReader'].includes(call.method),
  bindFileSystem: async cwd => {
    const facade = new NodeExecutionEnv({ cwd });
    return { identity, environment: facade, ownership: 'borrowed', release: async cleanupContext => {
      released++; await facade.cleanup(cleanupContext);
    } };
  },
}) });
const lease = createRemoteFileSystemLease({
  identity, filesystemId: native.id, cwd: directory,
  endpoint: 'https://fictional.invalid/files', fetch: handler,
});
try {
  assert.equal('exec' in lease.environment, false);
  getOrThrow(await lease.environment.writeFile('note.txt', 'Fictional first line\nFinal line', context));
  const reader = getOrThrow(await lease.environment.openTextLineReader('note.txt', context));
  const lines = [];
  try {
    for (;;) {
      const line = getOrThrow(await reader.readLine(context));
      if (line === undefined) break;
      lines.push(line);
    }
  } finally { await reader.close(context); }
  assert.deepEqual(lines, [
    { text: 'Fictional first line', terminated: true },
    { text: 'Final line', terminated: false },
  ]);
  assert.equal(released, 2);
  // Bytes travel as base64 and unbounded line counts are legal, so multi-MiB files round-trip and caller abort is reported as such.
  const large = Uint8Array.from({ length: 3 * 1024 * 1024 }, (_, index) => index * 7 & 255);
  const roomy = createRemoteFileSystemLease({ identity, filesystemId: native.id, cwd: directory, endpoint: 'https://fictional.invalid/files', fetch: createRemoteFileSystemHandler({ authenticate: async () => ({
    identity, filesystemId: native.id, context, revoked: revoked.signal, authorize: () => true,
    bindFileSystem: async cwd => ({ identity, environment: new NodeExecutionEnv({ cwd }), ownership: 'borrowed', release: async () => {} }),
  }), maxRequestBytes: 8_388_608, maxResponseBytes: 8_388_608 }), maxRequestBytes: 8_388_608, maxResponseBytes: 8_388_608 });
  try {
    getOrThrow(await roomy.environment.writeFile('large.bin', large, context));
    assert.ok(Buffer.from(getOrThrow(await roomy.environment.readBinaryFile('large.bin', context))).equals(large));
    assert.deepEqual(getOrThrow(await roomy.environment.readTextLines('note.txt', { maxLines: Infinity }, context)), ['Fictional first line', 'Final line']);
    const cancel = new AbortController(), pending = roomy.environment.readBinaryFile('large.bin', { ...context, abortSignal: cancel.signal });
    cancel.abort();
    assert.equal((await pending).error?.code, 'aborted');
  } finally { await roomy.release(context); }
  console.log(JSON.stringify(lines));
  console.log('Native files through in-process Fetch; two facades released; no shell capability exposed.');
} finally {
  await lease.release(context);
  await native.cleanup(context);
  await rm(directory, { recursive: true, force: true });
}
