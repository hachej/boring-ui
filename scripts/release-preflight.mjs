import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPackages } from './check-npm-packages.mjs';
import { publishRelease } from './publish-npm-packages.mjs';
import { runCaptured } from './run-captured.mjs';

export async function releasePreflight(root, commit) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-release-preflight-'));
  try {
    const archives = join(directory, 'archives');
    const checked = checkPackages(root, { release: true, outputDirectory: archives, commit });
    if (checked.errors.length) throw new Error(checked.errors.join('\n'));
    const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return await publishRelease(archives, { root, commit, version, tag: 'next', dryRun: true });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const git = runCaptured('git', ['rev-parse', 'HEAD'], { cwd: root });
  if (git.status !== 0) throw new Error('Release preparation requires a Git checkout');
  console.log(JSON.stringify(await releasePreflight(root, git.stdout.trim()), null, 2));
}
