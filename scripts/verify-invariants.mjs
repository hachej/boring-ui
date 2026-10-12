import { runCaptured } from './run-captured.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBoundary } from './check-pi-boundary.mjs';

export function verifyInvariants(root, { release = false, run = runCaptured } = {}) {
  const result = loadBoundary(root);
  const logs = [...result.errors];
  if (result.errors.length) return { status: 1, logs };
  const commands = new Map();
  const journeys = [];
  // Feature laws (VERIFY.json `features`): structural commands run here; their journeys run with the journeys and are only listed.
  for (const [id, rule] of [...Object.entries(result.registry.invariants), ...Object.entries(result.registry.features ?? {})]) for (const verifier of rule.verifiers) {
    if (verifier.kind === 'journey') journeys.push(`Journey evidence for ${id} (run with the journeys): ${Object.entries(verifier.env ?? {}).map(([key, value]) => `${key}=${value} `).join('')}${verifier.command.join(' ')}`);
    if (verifier.kind !== 'command') continue;
    const key = JSON.stringify(verifier.command);
    if (!commands.has(key)) commands.set(key, { command: verifier.command, laws: [] });
    commands.get(key).laws.push(id);
  }
  // Package behavior is tested now; global qualification remains separate.
  for (const proof of result.implementationProofs) {
    const key = JSON.stringify(proof.command);
    if (!commands.has(key)) commands.set(key, { command: proof.command, laws: [`implementation:${proof.package}`] });
  }
  let status = 0;
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; // A new test process is not its parent's test worker.
  for (const { command, laws } of commands.values()) {
    logs.push(`Evidence for ${laws.join(', ')}: ${command.join(' ')}`);
    const ran = run(process.execPath, ['--test', '--experimental-test-isolation=none', '--test-reporter=tap', ...command.slice(2)], { cwd: root, encoding: 'utf8', timeout: 60000, env });
    if (ran.status !== 0 || ran.error || ran.signal || !/^# pass [1-9]\d*$/m.test(ran.stdout ?? '') || !/^# skipped 0$/m.test(ran.stdout ?? '') || !/^# todo 0$/m.test(ran.stdout ?? '')) {
      logs.push(ran.stderr || ran.stdout || ran.error?.message || `signal: ${ran.signal}`);
      logs.push('Evidence failed: error, timeout, no passing tests or skipped/todo obligations.');
      status = 1;
    }
  }
  logs.push(...journeys);
  for (const pending of result.pending) logs.push(`DEFERRED ${pending.id}: ${pending.command.join(' ')}\n  ${pending.reason}`);
  if (result.pending.length) {
    logs.push(`Runtime verification INCOMPLETE: ${result.pending.length} deferred proofs are not passes.`);
    // Owner ruling 2026-10-10: deferred proofs are backlog, not release blockers. They stay listed above and in release.json; real failures still fail.
    if (release) logs.push(`Release: ${result.pending.length} deferred proofs recorded as backlog (owner ruling 2026-10-10); they do not block publication.`);
  } else if (!status) logs.push('Registered boundary evidence passed; scope is the claims in VERIFY.json.');
  return { status, logs, deferred: result.pending.map(({ id, command, reason }) => ({ id, command, reason })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyInvariants(fileURLToPath(new URL('../', import.meta.url)), { release: process.argv.includes('--release') });
  console.log(result.logs.join('\n'));
  process.exitCode = result.status;
}
