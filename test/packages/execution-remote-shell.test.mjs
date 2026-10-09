import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemoteShellHandler, createRemoteShellLease } from '@hachej/boring-execution/remote-shell';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { ExecutionError, getOrThrow } from '@earendil-works/pi-durable/env';
import { BACKGROUND_CONTEXT as context, withCancel } from '@earendil-works/chord/context';
import { Harness, MemoryStorage, createRegistry, defineExtension, defineTool, ToolResultEntry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { Type } from 'typebox';
import { admitDocumentTool } from '../fixtures/native-document.mjs';

const identity = { providerId: 'fictional-http-shell', instanceId: 'machine-1', incarnation: 'generation-1', viewId: 'working-1' };
const endpoint = 'https://fictional.invalid/shell';
const deferred = () => Promise.withResolvers();
const failure = (result, code) => {
  assert.equal(result.ok, false);
  assert.ok(result.error instanceof ExecutionError);
  assert.equal(result.error.code, code);
};

async function fixture(t, handlerOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'boring-remote-shell-'));
  const native = new NodeExecutionEnv({ cwd: directory, shellPath: '/bin/bash', shellEnv: { PATH: '/usr/bin:/bin' } });
  const calls = [], revoked = new AbortController();
  let cleanupCalls = 0;
  const access = {
    identity, context, revoked: revoked.signal, supports: { timeout: true, spill: true },
    authorize: () => true,
    shell: {
      exec: (...args) => { calls.push(args); return native.exec(...args); },
      cleanup: async ctx => { cleanupCalls++; await native.cleanup(ctx); },
    },
  };
  const handler = createRemoteShellHandler({ authenticate: async () => access, ...handlerOptions });
  const leases = [];
  const lease = (options = {}) => {
    const value = createRemoteShellLease({ identity, endpoint, fetch: handler, ...options });
    leases.push(value); return value;
  };
  t.after(async () => {
    for (const value of leases) await value.release(context);
    await native.cleanup(context);
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, native, calls, access, handler, lease, revoked, cleanupCalls: () => cleanupCalls };
}

test('Fetch loopback preserves native cwd, environment, nonzero exit and live combined output', { timeout: 10000 }, async t => {
  const f = await fixture(t), lease = f.lease(), first = deferred();
  const cwd = join(f.directory, 'chosen'); await mkdir(cwd);
  const chunks = []; let settled = false;
  const command = 'printf "first:%s:%s\\n" "$PWD" "$FICTIONAL_VALUE"; while [ ! -f release ]; do sleep 0.01; done; printf second >&2; exit 7';
  const pending = lease.environment.exec(command, {
    cwd, env: { FICTIONAL_VALUE: 'value with spaces' }, inheritEnv: false,
    onOutput: (text, ctx) => { assert.equal(ctx, context); chunks.push(text); first.resolve(); },
  }, context).then(value => { settled = true; return value; });
  await first.promise;
  assert.equal(settled, false, 'output arrives while the native command is still waiting');
  assert.equal(chunks.join(''), `first:${cwd}:value with spaces\n`);
  await writeFile(join(cwd, 'release'), 'fictional release');
  assert.deepEqual(getOrThrow(await pending), { exitCode: 7 });
  assert.equal(chunks.join(''), `first:${cwd}:value with spaces\nsecond`);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], command);
  assert.deepEqual(f.calls[0][1].env, { FICTIONAL_VALUE: 'value with spaces' });
  assert.equal(f.calls[0][1].inheritEnv, false);
  assert.equal(f.native.cwd, f.directory);
});

test('native timeout and spill results preserve remote spill contents and native error identity', { timeout: 10000 }, async t => {
  const f = await fixture(t), shell = f.lease().environment, chunks = [];
  const result = getOrThrow(await shell.exec('printf "alpha\\nbeta\\ngamma\\n"', {
    spill: { afterBytes: 1, afterLines: 1 }, onOutput: text => chunks.push(text),
  }, context));
  assert.equal(result.exitCode, 0); assert.equal(typeof result.spillPath, 'string');
  t.after(() => rm(result.spillPath, { force: true }));
  assert.equal(await readFile(result.spillPath, 'utf8'), 'alpha\nbeta\ngamma\n');
  assert.equal(chunks.join(''), 'alpha\nbeta\ngamma\n');
  const timed = await shell.exec('printf "before timeout\\n"; sleep 3', { timeout: 0.05, spill: { afterBytes: 1, afterLines: 1 } }, context);
  failure(timed, 'timeout');
  assert.equal(typeof timed.error.spillPath, 'string');
  t.after(() => rm(timed.error.spillPath, { force: true }));
  assert.equal(await readFile(timed.error.spillPath, 'utf8'), 'before timeout\n');
});

test('concurrent requests capture independent native cwd and environment before host authorization waits', { timeout: 10000 }, async t => {
  const f = await fixture(t), admitted = deferred(), proceed = deferred();
  const left = join(f.directory, 'left'), right = join(f.directory, 'right');
  await Promise.all([mkdir(left), mkdir(right)]);
  const authorized = [];
  f.access.authorize = async (command, options) => {
    authorized.push({ command, options: structuredClone(options) });
    options.cwd = '/fictional-policy-mutation';
    options.env.VALUE = 'mutated by policy';
    if (authorized.length === 2) admitted.resolve();
    await proceed.promise; return true;
  };
  const outputs = [[], []], options = [
    { cwd: left, env: { VALUE: 'left value' }, inheritEnv: false, onOutput: text => outputs[0].push(text) },
    { cwd: right, env: { VALUE: 'right value' }, inheritEnv: false, onOutput: text => outputs[1].push(text) },
  ];
  const shell = f.lease().environment;
  const pending = options.map(value => shell.exec('printf "%s:%s" "$PWD" "$VALUE"', value, context));
  options[0].cwd = right; options[0].env.VALUE = 'late caller mutation';
  await admitted.promise; assert.equal(f.calls.length, 0); proceed.resolve();
  for (const result of await Promise.all(pending)) assert.equal(getOrThrow(result).exitCode, 0);
  assert.deepEqual(outputs.map(chunks => chunks.join('')), [`${left}:left value`, `${right}:right value`]);
  assert.equal(authorized.length, 4, 'authorization is rechecked before terminal disclosure');
  assert.equal(authorized[0].options.env.VALUE, 'left value');
  assert.equal(f.native.cwd, f.directory);
});

test('native Harness executes a ToolTask with a borrowed shell-only lease and no environment factory', { timeout: 15000 }, async t => {
  const f = await fixture(t), lease = f.lease();
  assert.deepEqual(Object.keys(lease.environment).sort(), ['cleanup', 'exec']);
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fictional.remote-shell', tools: [defineTool({
    name: 'remote_command', description: 'Fictional shell-only command', parameters: Type.Object({ command: Type.String() }), replay: 'unsafe',
    execute: async (args, api, ctx) => {
      assert.equal(api.env, undefined);
      const result = getOrThrow(await lease.environment.exec(args.command, { onOutput: text => api.output(text) }, ctx));
      assert.equal(result.exitCode, 0); return {};
    },
  })] }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.root(context);
  const taskId = await admitDocumentTool(conversation, { command: 'printf fictional-native-tool > artifact; cat artifact' }, 'remote_command');
  const terminal = await harness.waitForTask(taskId, context);
  assert.equal(terminal.state.outcome.status, 'completed');
  const entry = await conversation.commit(tx => tx.entry(ToolResultEntry, terminal.state.outcome.result.entryId), context);
  assert.equal(entry.model[0].isError, false);
  assert.equal(entry.model[0].content[0].text, 'fictional-native-tool');
  assert.equal(await readFile(join(f.directory, 'artifact'), 'utf8'), 'fictional-native-tool');
  assert.equal(f.calls.length, 1);
});

test('authentication, exact identity, authorization and unsupported guarantees refuse before native execution', async t => {
  const f = await fixture(t);
  const denied = createRemoteShellHandler({ authenticate: async () => null });
  failure(await f.lease({ fetch: denied }).environment.exec('printf forbidden > artifact', undefined, context), 'unknown');
  for (const key of ['providerId', 'instanceId', 'incarnation', 'viewId']) {
    failure(await f.lease({ identity: { ...identity, [key]: 'different' } }).environment.exec('printf forbidden > artifact', undefined, context), 'unknown');
  }
  f.access.authorize = () => false;
  failure(await f.lease().environment.exec('printf forbidden > artifact', undefined, context), 'unknown');
  f.access.authorize = () => true;
  f.access.supports = { timeout: false, spill: false };
  for (const options of [{ timeout: 1 }, { spill: { afterBytes: 1, afterLines: 1 } }]) {
    failure(await f.lease().environment.exec('printf forbidden > artifact', options, context), 'unknown');
  }
  assert.equal(f.calls.length, 0);
  assert.equal(getOrThrow(await f.native.exists('artifact', context)), false);
});

test('a response lost after a real mutation reports unknown and never retries', async t => {
  const f = await fixture(t); let requests = 0;
  const lease = f.lease({ fetch: async request => {
    requests++;
    const response = await f.handler(request);
    await response.text();
    throw new Error('Fictional connection loss after terminal acknowledgement was lost');
  } });
  const result = await lease.environment.exec('printf effect >> effects', undefined, context);
  failure(result, 'unknown');
  assert.match(result.error.message, /unconfirmed|prior effects/);
  assert.equal(await readFile(join(f.directory, 'effects'), 'utf8'), 'effect');
  assert.equal(requests, 1); assert.equal(f.calls.length, 1);
});

test('malformed, reordered and duplicate terminal frames never become success', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const mutations = [
    frames => frames.slice(1),
    frames => [frames[0], frames.at(-1), frames[1]],
    frames => [...frames, { ...frames.at(-1), sequence: frames.length }],
    frames => frames.slice(0, -1),
    frames => frames.map((frame, index) => index === 1 ? { ...frame, sequence: 50 } : frame),
    frames => [{ ...frames[0], identity: { ...identity, incarnation: 'replacement' } }, ...frames.slice(1)],
    frames => [{ ...frames[0], requestId: 'different-call' }, ...frames.slice(1)],
    frames => [{ ...frames[0], version: 999 }, ...frames.slice(1)],
    frames => frames.map(frame => frame.type === 'result' ? { ...frame, result: { ok: true, value: { exitCode: 0.5 } } } : frame),
  ];
  for (const [index, mutate] of mutations.entries()) {
    const lease = f.lease({ fetch: async request => {
      const response = await f.handler(request);
      const frames = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
      return new Response(mutate(frames).map(frame => JSON.stringify(frame)).join('\n') + '\n', { headers: response.headers });
    } });
    const disclosed = [];
    failure(await lease.environment.exec('printf fictional', { onOutput: text => disclosed.push(text) }, context), 'unknown');
    if ([0, 5, 6, 7].includes(index)) assert.deepEqual(disclosed, [], 'unbound or unsupported streams disclose no output');
  }
  for (const ending of ['{not-json}\n', '{"unfinished":true}', new Uint8Array([255, 10])]) {
    const lease = f.lease({ fetch: async () => new Response(ending, { headers: { 'content-type': 'application/x-ndjson' } }) });
    failure(await lease.environment.exec('unused', undefined, context), 'unknown');
  }
});

test('caller abort settles a pending fetch and cancels a response that arrives late', { timeout: 5000 }, async t => {
  const f = await fixture(t), started = deferred(), response = deferred(), cancelled = deferred(), call = withCancel(context);
  let signal;
  const lease = f.lease({ fetch: request => { signal = request.signal; started.resolve(); return response.promise; } });
  const pending = lease.environment.exec('never dispatched by fictional transport', undefined, call.context);
  await started.promise; call.cancel(); failure(await pending, 'aborted'); assert.equal(signal.aborted, true);
  response.resolve(new Response(new ReadableStream({ cancel: () => cancelled.resolve() })));
  await cancelled.promise;
  assert.equal(f.calls.length, 0);
});

test('caller abort interrupts a pending response read without confirming remote termination', { timeout: 5000 }, async t => {
  const f = await fixture(t), started = deferred(), cancelled = deferred(), call = withCancel(context);
  const lease = f.lease({ fetch: async () => new Response(new ReadableStream({
    pull() { started.resolve(); }, cancel() { cancelled.resolve(); },
  }), { headers: { 'content-type': 'application/x-ndjson' } }) });
  const pending = lease.environment.exec('fictional-pending', undefined, call.context);
  await started.promise; call.cancel();
  const result = await pending; failure(result, 'aborted'); assert.match(result.error.message, /unconfirmed/);
  await cancelled.promise;
});

test('local output callback errors remain typed failures and do not replay commands', async t => {
  const f = await fixture(t), lease = f.lease(); let callbacks = 0;
  const result = await lease.environment.exec('printf fictional', { onOutput: () => { callbacks++; throw new Error('fictional viewer detached'); } }, context);
  failure(result, 'callback_error');
  assert.equal(callbacks, 1); assert.equal(f.calls.length, 1);
  assert.match(result.error.message, /unconfirmed/);
});

test('transport output limits refuse oversized native output instead of truncated success', async t => {
  const f = await fixture(t, { maxFrameBytes: 512, maxQueuedBytes: 1024 });
  const result = await f.lease().environment.exec('printf "%02000d" 0', { onOutput: () => {} }, context);
  failure(result, 'unknown'); assert.equal(f.calls.length, 1);
  const limited = f.lease({ maxFrameBytes: 16 });
  failure(await limited.environment.exec('printf short', undefined, context), 'unknown');
});

test('exit-only native commands do not allocate output frames or overflow the remote stream queue', async t => {
  const f = await fixture(t, { maxFrameBytes: 512, maxQueuedBytes: 1024 });
  const result = await f.lease().environment.exec('printf "%02000d" 0', undefined, context);
  assert.deepEqual(getOrThrow(result), { exitCode: 0 });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][1].onOutput, undefined);
});

test('abort from an output callback prevents later frames already buffered in the same response from escaping', async t => {
  const f = await fixture(t), call = withCancel(context), chunks = [];
  const lease = f.lease({ fetch: async request => {
    const response = await f.handler(request);
    const frames = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    const output = frames.find(frame => frame.type === 'output');
    const split = [frames[0], { ...output, text: 'fic' }, { ...output, text: 'tional' }, frames.at(-1)];
    return new Response(split.map((frame, sequence) => JSON.stringify({ ...frame, sequence })).join('\n') + '\n', { headers: response.headers });
  } });
  const result = await lease.environment.exec('printf fictional', { onOutput: text => { chunks.push(text); call.cancel(); } }, call.context);
  failure(result, 'aborted'); assert.deepEqual(chunks, ['fic']);
});

test('borrowed lease cleanup cancels only its active observation and never cleans up the host Shell', { timeout: 10000 }, async t => {
  const f = await fixture(t), left = f.lease(), right = f.lease();
  assert.equal(left.ownership, 'borrowed'); assert.deepEqual(left.identity, identity);
  const leftStarted = deferred(), rightStarted = deferred();
  const leftPending = left.environment.exec('printf left-ready; sleep 3', { onOutput: () => leftStarted.resolve() }, context);
  const rightChunks = [];
  const rightPending = right.environment.exec('printf right-ready; while [ ! -f release-right ]; do sleep 0.01; done; printf right-finished', {
    onOutput: text => { rightChunks.push(text); rightStarted.resolve(); },
  }, context);
  await Promise.all([leftStarted.promise, rightStarted.promise]);
  await left.release(context); await left.environment.cleanup(context); await left.release(context);
  failure(await leftPending, 'aborted');
  await writeFile(join(f.directory, 'release-right'), 'fictional release');
  assert.equal(getOrThrow(await rightPending).exitCode, 0);
  assert.equal(rightChunks.join(''), 'right-readyright-finished');
  failure(await left.environment.exec('printf closed', undefined, context), 'shell_unavailable');
  const chunks = [];
  assert.equal(getOrThrow(await right.environment.exec('printf alive', { onOutput: text => chunks.push(text) }, context)).exitCode, 0);
  assert.equal(chunks.join(''), 'alive'); assert.equal(f.cleanupCalls(), 0);
});

test('host revocation interrupts a silent admitted command without reporting success', { timeout: 5000 }, async t => {
  const f = await fixture(t), admitted = deferred();
  const nativeExec = f.access.shell.exec;
  f.access.shell.exec = (...args) => { admitted.resolve(); return nativeExec(...args); };
  const pending = f.lease().environment.exec('sleep 3', undefined, context);
  await admitted.promise; f.revoked.abort();
  const result = await pending; failure(result, 'unknown'); assert.match(result.error.message, /unconfirmed/);
  assert.equal(f.calls.length, 1);
});

test('invalid local command limits refuse without dispatch and server authorization requires true', async t => {
  const f = await fixture(t);
  let dispatches = 0;
  const shell = f.lease({ fetch: request => { dispatches++; return f.handler(request); } }).environment;
  for (const timeout of [0, -1, NaN, Infinity]) {
    failure(await shell.exec('printf forbidden', { timeout }, context), 'shell_unavailable');
  }
  assert.equal(dispatches, 0);
  for (const allowed of [1, 'yes', {}, null]) {
    f.access.authorize = () => allowed;
    failure(await shell.exec('printf forbidden', undefined, context), 'unknown');
  }
  assert.equal(f.calls.length, 0);
});
