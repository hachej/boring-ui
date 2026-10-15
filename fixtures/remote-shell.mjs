import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemoteShellHandler, createRemoteShellLease } from '@hachej/boring-execution/remote-shell';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { getOrThrow } from '@earendil-works/pi-durable/env';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';

const directory = await mkdtemp(join(tmpdir(), 'fictional-remote-shell-'));
const shell = new NodeExecutionEnv({ cwd: directory, shellPath: '/bin/bash', shellEnv: { PATH: '/usr/bin:/bin' } });
const identity = { providerId: 'fictional', instanceId: 'one', incarnation: 'one', viewId: 'working' };
const revoked = new AbortController();
const command = 'printf "%s" "$FICTIONAL_MESSAGE"';
const handler = createRemoteShellHandler({ authenticate: async () => ({
  identity, shell, context, revoked: revoked.signal,
  authorize: requested => requested === command,
  supports: { timeout: true, spill: true },
}) });
const lease = createRemoteShellLease({ identity, endpoint: 'https://fictional.invalid/shell', fetch: handler });
try {
  const output = [];
  const result = getOrThrow(await lease.environment.exec(command, {
    env: { FICTIONAL_MESSAGE: 'Fictional native command through Fetch streams' },
    inheritEnv: false, timeout: 1, onOutput: text => output.push(text),
  }, context));
  assert.equal(result.exitCode, 0);
  assert.equal(output.join(''), 'Fictional native command through Fetch streams');
  console.log(output.join(''));
  console.log('Exit 0; in-process transport only; borrowed provider remains host-owned.');
} finally {
  await lease.release(context);
  await shell.cleanup(context);
  await rm(directory, { recursive: true, force: true });
}
