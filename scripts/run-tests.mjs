import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export function testFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) throw new Error(`Test symlink is not auditable: ${entry.name}`);
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.name.endsWith('.test.mjs') ? [path] : [];
  }).sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => arg !== '--exclude-registered')) throw new Error(`Unknown test runner argument: ${args.join(' ')}`);
  const root = fileURLToPath(new URL('../', import.meta.url));
  let files = testFiles(resolve(root, 'test'));
  if (args.includes('--exclude-registered')) {
    const { loadBoundary } = await import('./check-pi-boundary.mjs');
    const boundary = loadBoundary(root);
    if (boundary.errors.length) throw new Error(boundary.errors.join('\n'));
    // CI's release gate executes these files with the stricter registered-evidence checks.
    const registered = new Set([
      ...[...Object.values(boundary.registry.invariants), ...Object.values(boundary.registry.features ?? {})].flatMap(rule => rule.verifiers.filter(proof => proof.kind === 'command').flatMap(proof => proof.command.slice(2))),
      ...boundary.implementationProofs.flatMap(proof => proof.command.slice(2)),
    ].map(path => resolve(root, path)));
    for (const path of registered) if (!files.includes(path)) throw new Error(`Registered test not discovered: ${path}`);
    files = files.filter(path => !registered.has(path));
  }
  if (!files.length) throw new Error('No tests discovered');
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--import', fileURLToPath(new URL('./css-stub-register.mjs', import.meta.url)), '--test', '--experimental-test-isolation=none', ...files], { stdio: 'inherit', env });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
