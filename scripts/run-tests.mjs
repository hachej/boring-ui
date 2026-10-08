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
  const files = testFiles(fileURLToPath(new URL('../test', import.meta.url)));
  if (!files.length) throw new Error('No tests discovered');
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', '--experimental-test-isolation=none', ...files], { stdio: 'inherit', env });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
