import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Owner ruling 2026-10-10: these workspace packages stay private and are never packed for release or published.
export const INTENTIONALLY_PRIVATE = new Set(['@hachej/boring-browser', '@hachej/boring-testing']);

export const isExcludedFromRelease = manifest => manifest.private === true && INTENTIONALLY_PRIVATE.has(manifest.name);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Workflow guard: a retained release directory must not contain any intentionally private package.
  const release = JSON.parse(readFileSync(join(process.argv[2], 'release.json'), 'utf8'));
  const leaked = release.packages.filter(pack => INTENTIONALLY_PRIVATE.has(pack.name)).map(pack => pack.name);
  if (leaked.length) { console.error(`Private packages in release artifact: ${leaked.join(', ')}`); process.exitCode = 1; }
  else console.log(`Publish set: ${release.packages.map(pack => pack.name).join(', ')}`);
}
