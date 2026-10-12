// Builds public/r from registry.json with the pinned shadcn CLI, then makes every item's `@boring-ui/<item>` registryDependencies an
// absolute, versioned URL of this release: https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@<version>/r/<item>.json. A consumer
// therefore needs no `registries` line. release-version.mjs rewrites those URLs on a version bump, and check-npm-packages.mjs
// accepts only the current version.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const namespace = '@boring-ui/';
const kit = '@hachej/boring-ui-kit';

export const releaseItemBase = version => `https://cdn.jsdelivr.net/npm/${kit}@${version}/r`;

/** The version of @hachej/boring-ui-kit in this workspace, which the absolute item URLs name. */
export function kitVersion(root) {
  for (const entry of readdirSync(join(root, 'packages'))) {
    const manifest = JSON.parse(readFileSync(join(root, 'packages', entry, 'package.json'), 'utf8'));
    if (manifest.name === kit) return manifest.version;
  }
  throw new Error(`Missing workspace package ${kit}`);
}

/** Rewrites the `@boring-ui/<item>` dependencies of an item, and of each item the registry index lists, to this release's URLs. */
export function releaseDependencies(item, version) {
  const rewrite = entry => { if (entry.registryDependencies) entry.registryDependencies = entry.registryDependencies.map(dependency => dependency.startsWith(namespace) ? `${releaseItemBase(version)}/${dependency.slice(namespace.length)}.json` : dependency); };
  rewrite(item);
  for (const entry of item.items ?? []) rewrite(entry);
  return item;
}

/** Finishes every JSON file of `directory` for the release. Files keep a trailing newline, as committed. */
export function finishRegistry(directory, version) {
  for (const file of readdirSync(directory).filter(name => name.endsWith('.json'))) {
    const path = join(directory, file);
    writeFileSync(path, JSON.stringify(releaseDependencies(JSON.parse(readFileSync(path, 'utf8')), version), null, 2) + '\n');
  }
}

/** Runs the pinned shadcn CLI into `outputDirectory`, then finishes the items for the workspace's release version. */
export function buildRegistry(root, outputDirectory) {
  const cli = createRequire(import.meta.url).resolve('shadcn');
  const result = runCaptured(process.execPath, [cli, 'build', 'registry.json', '--output', outputDirectory], { cwd: root, timeout: 120000 });
  if (result.status !== 0 || result.error) throw new Error(`shadcn build failed: ${result.error?.message ?? ''}\n${result.stderr}${result.stdout}`);
  finishRegistry(outputDirectory, kitVersion(root));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildRegistry(root, join(root, 'public/r'));
  console.log(`Built public/r for ${kit}@${kitVersion(root)}`);
}
