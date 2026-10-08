import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';

// Actual pinned native implementation, not a sandbox adapter. Reuse is valid
// within a stable binding; incompatible cwd calls must not mutate one facade.
// No command/model runs and no tenant confinement is claimed by this fixture.
test('concurrent same-namespace reads preserve stable cwd reuse; mutable shared facade fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'boring-native-cwd-'));
  const a = join(root, 'a'), b = join(root, 'b');
  mkdirSync(a); mkdirSync(b);
  writeFileSync(join(a, 'value.txt'), 'A'); writeFileSync(join(b, 'value.txt'), 'B');
  const envA = new NodeExecutionEnv({ cwd: a });
  const envB = new NodeExecutionEnv({ cwd: b });
  const bad = new NodeExecutionEnv({ cwd: a });
  const readAfter = async (env, gate) => {
    await gate;
    const result = await env.readTextFile('value.txt', context);
    if (!result.ok) throw result.error;
    return result.value;
  };
  try {
    assert.equal(envA.id, envB.id);
    const goodGate = Promise.withResolvers();
    const goodA = readAfter(envA, goodGate.promise);
    const reusedA = readAfter(envA, goodGate.promise);
    const goodB = readAfter(envB, goodGate.promise);
    goodGate.resolve();
    assert.deepEqual(await Promise.all([goodA, reusedA, goodB]), ['A', 'A', 'B']);
    const badGate = Promise.withResolvers();
    bad.cwd = a; const pendingA = readAfter(bad, badGate.promise);
    bad.cwd = b; const pendingB = readAfter(bad, badGate.promise);
    badGate.resolve();
    assert.deepEqual(await Promise.all([pendingA, pendingB]), ['B', 'B'], 'negative control exposes shared mutable cwd');
  } finally {
    await Promise.all([envA.cleanup(context), envB.cleanup(context), bad.cleanup(context)]);
    rmSync(root, { recursive: true, force: true });
  }
});
