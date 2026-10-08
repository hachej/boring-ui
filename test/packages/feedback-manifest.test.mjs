// Adoption checks on what an outside application installs (found by the feedback scenario, docs/implementation/FEEDBACK-SCENARIO.md):
// every package the published JavaScript and declarations import is declared in the manifest, and every export target is in the tarball.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from '../../scripts/run-captured.mjs';

const directory = fileURLToPath(new URL('../../packages/feedback/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
const packageOf = specifier => specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];

test('@hachej/boring-feedback declares every package its dist imports (strict installers resolve only declared ones)', () => {
  const declared = new Set([manifest.name, ...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]);
  const undeclared = [];
  for (const file of files(join(directory, 'dist')).filter(path => /\.(?:js|d\.ts)$/.test(path))) {
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'".][^'"]*)['"]/g)) {
      if (!specifier.startsWith('node:') && !declared.has(packageOf(specifier))) undeclared.push(`${relative(directory, file)}: ${specifier}`);
    }
  }
  assert.deepEqual(undeclared, []);
  // The source helper is optional: its React runtime and esbuild types must not be required of annotation-only applications.
  for (const name of ['react', 'esbuild']) assert.equal(manifest.peerDependenciesMeta?.[name]?.optional, true, `${name} is an optional peer`);
});

test('@hachej/boring-feedback tarball holds every export target', () => {
  const result = runCaptured('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: directory, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  const packed = new Set(JSON.parse(result.stdout)[0].files.map(file => file.path));
  const missing = Object.entries(manifest.exports).flatMap(([subpath, targets]) => Object.values(targets).map(target => target.replace(/^\.\//, '')).filter(target => !packed.has(target)).map(target => `${subpath} → ${target}`));
  assert.deepEqual(missing, []);
});
