import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { DurablePauseStore, requestToolPause, resumeToolCall } from '../src/durable-pause.js';

const stores = [];

afterEach(() => {
  while (stores.length) stores.pop().close();
});

function makeStore(options) {
  const dir = mkdtempSync(join(tmpdir(), 'durable-pause-'));
  const store = new DurablePauseStore(join(dir, 'pause.sqlite'), options);
  stores.push(store);
  return store;
}

function input(overrides = {}) {
  return {
    sessionId: 's1', submissionId: 'sub1', toolCallId: 'tool1', kind: 'approval',
    actionName: 'deploy.release', args: { version: 7, env: 'production' },
    answerPolicy: ['alice'], createdAt: 1_000, expiresAt: 2_000,
    ...overrides,
  };
}

describe('durable human-in-the-loop pause', () => {
  test('T1 restart continuation survives a real process kill', () => {
    const proofPath = new URL('../scripts/restart-proof.sh', import.meta.url).pathname;
    const run = spawnSync('bash', [proofPath], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    const [firstLine, secondLine] = run.stdout.trim().split('\n');
    const first = JSON.parse(firstLine);
    const proof = JSON.parse(secondLine);

    expect(first.pid).not.toBe(proof.pid);
    expect(proof).toMatchObject({
      killedWith: 'SIGKILL',
      answered: { disposition: 'accepted' },
      completed: {
        status: 'completed',
        toolCallId: 'tool-call-1',
        answer: { approved: true, note: 'ship it' },
      },
    });
    console.log(`T1 requester_pid=${first.pid} resumer_pid=${proof.pid} killed=SIGKILL pause_id=${first.pauseId} status=${proof.completed.status}`);
  });

  test('T2 stale answer is demoted and cannot authorize the call', () => {
    const store = makeStore();
    const pause = store.requestPause(input());
    const result = store.answerPause({
      pauseId: pause.pause_id, actionName: 'deploy.release', args: { version: 8, env: 'production' },
      respondedBy: 'alice', payload: { approved: true }, now: 1_100,
    });
    expect(result).toEqual({ disposition: 'demoted', reason: 'stale' });
    expect(store.getPause(pause.pause_id).state).toBe('pending');
    expect(store.listResponseAttempts(pause.pause_id)[0].disposition).toBe('demoted');
    expect(() => resumeToolCall(store, {
      pauseId: pause.pause_id, continuationKey: pause.continuation_key, toolCallId: pause.tool_call_id,
    })).toThrow('pause is not responded');
    console.log(`T2 pause_id=${pause.pause_id} disposition=demoted state=pending resumed=false`);
  });

  test('T3 approval is consumed once; bypassing the app guard still hits SQLite', () => {
    const store = makeStore({ unsafeSkipAppGuards: true });
    const pause = store.requestPause(input());
    store.answerPause({ pauseId: pause.pause_id, actionName: input().actionName, args: input().args, respondedBy: 'alice', payload: { approved: true }, now: 1_100 });
    const resume = { pauseId: pause.pause_id, continuationKey: pause.continuation_key, toolCallId: pause.tool_call_id, now: 1_200 };
    expect(store.consumePause(resume)).toEqual({ approved: true });
    expect(() => store.consumePause(resume)).toThrow(/UNIQUE constraint failed/);
    expect(store.consumptionCount(pause.pause_id)).toBe(1);
    console.log(`T3 pause_id=${pause.pause_id} first=consumed replay=SQLITE_CONSTRAINT count=1`);
  });

  test('T4 expired pause cannot be answered', () => {
    const store = makeStore();
    const pause = store.requestPause(input());
    const result = store.answerPause({ pauseId: pause.pause_id, actionName: input().actionName, args: input().args, respondedBy: 'alice', payload: { approved: true }, now: 2_000 });
    expect(result).toEqual({ disposition: 'demoted', reason: 'expired' });
    expect(store.getPause(pause.pause_id).state).toBe('expired');
    console.log(`T4 pause_id=${pause.pause_id} disposition=demoted state=expired`);
  });

  test('T5 unauthorized principal cannot answer', () => {
    const store = makeStore();
    const pause = store.requestPause(input());
    const result = store.answerPause({ pauseId: pause.pause_id, actionName: input().actionName, args: input().args, respondedBy: 'mallory', payload: { approved: true }, now: 1_100 });
    expect(result).toEqual({ disposition: 'demoted', reason: 'unauthorized' });
    expect(store.getPause(pause.pause_id).state).toBe('pending');
    console.log(`T5 pause_id=${pause.pause_id} responder=mallory disposition=demoted state=pending`);
  });
});

describe('raw constraint probes used by mutation testing', () => {
  test('T1 continuation keys are unique so store-only lookup is unambiguous', () => {
    const store = makeStore();
    store.requestPause(input({ pauseId: 'p1', continuationKey: 'continuation' }));
    expect(() => store.requestPause(input({ pauseId: 'p2', continuationKey: 'continuation' }))).toThrow(/UNIQUE constraint failed/);
  });

  test('T2 match constraint survives adapter guard bypass', () => {
    const store = makeStore({ unsafeSkipAppGuards: true });
    const pause = store.requestPause(input());
    expect(() => store.answerPause({ pauseId: pause.pause_id, actionName: input().actionName, args: { wrong: true }, respondedBy: 'alice', payload: { approved: true }, now: 1_100 })).toThrow('stale or superseded pause');
  });

  test('T4 expiry constraint survives adapter guard bypass', () => {
    const store = makeStore({ unsafeSkipAppGuards: true });
    const pause = store.requestPause(input());
    expect(() => store.answerPause({ pauseId: pause.pause_id, actionName: input().actionName, args: input().args, respondedBy: 'alice', payload: { approved: true }, now: 2_000 })).toThrow('pause expired');
  });

  test('T5 authorization constraint survives adapter guard bypass', () => {
    const store = makeStore({ unsafeSkipAppGuards: true });
    const pause = store.requestPause(input());
    expect(() => store.answerPause({ pauseId: pause.pause_id, actionName: input().actionName, args: input().args, respondedBy: 'mallory', payload: { approved: true }, now: 1_100 })).toThrow('responder unauthorized');
  });
});
