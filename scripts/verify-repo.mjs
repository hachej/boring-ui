#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root, 'scripts/verify-repo.config.json'), 'utf8'));
const errors = [];
const warnings = [];
const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const walk = (directory, accept = () => true) => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return walk(path, accept);
    return accept(path) ? [path] : [];
  });
};
const readImports = (path) => [...readFileSync(path, 'utf8').matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].map((match) => match[1]);
const extOf = (path) => path.slice(path.lastIndexOf('.'));
const candidates = (path) => {
  const stem = path.replace(/\.(?:[cm]?[jt]sx?)$/, '');
  return [path, ...sourceExtensions.map((extension) => stem + extension), ...sourceExtensions.map((extension) => join(stem, `index${extension}`))];
};
const resolveRelative = (from, specifier, known) => candidates(resolve(dirname(from), specifier)).find((path) => known.has(path));
const sourceFiles = walk(join(root, 'packages'), (path) => /\/src\/.*\.(?:[cm]?[jt]sx?)$/.test(path) && !path.endsWith('.d.ts'));
const knownSources = new Set(sourceFiles);
const roots = new Set();

// Each public package export is a reachability root. Dist output mirrors src; tests are additional roots
// so internal testing helpers remain reachable without pretending they are published API.
for (const directory of readdirSync(join(root, 'packages'), { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
  const packageRoot = join(root, 'packages', directory.name);
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  for (const target of Object.values(manifest.exports ?? {})) {
    const file = typeof target === 'string' ? target : target?.import;
    if (typeof file !== 'string' || !file.startsWith('./dist/')) continue;
    const sourceBase = join(packageRoot, 'src', file.slice('./dist/'.length).replace(/\.js$/, ''));
    const source = candidates(sourceBase).find((path) => knownSources.has(path));
    if (source) roots.add(source);
    else errors.push(`repo verify: ${relative(root, packageRoot)} exports ${file}, but no matching source exists under src/`);
  }
}
const testFiles = walk(join(root, 'test'), (path) => /\.test\.[cm]?[jt]sx?$/.test(path));
for (const entry of config.additionalSourceRoots ?? []) {
  const directory = resolve(root, entry.path);
  if (!existsSync(directory) || !entry.reason) errors.push(`repo verify: invalid additional source root: ${entry.path}`);
  for (const file of walk(directory, (path) => sourceExtensions.includes(extOf(path)) && !path.endsWith('.d.ts'))) roots.add(file);
}
for (const test of testFiles) for (const specifier of readImports(test)) {
  if (!specifier.startsWith('.')) continue;
  const target = resolveRelative(test, specifier, knownSources);
  if (target) roots.add(target);
}
const graph = new Map(sourceFiles.map((file) => [file, readImports(file).filter((specifier) => specifier.startsWith('.')).map((specifier) => resolveRelative(file, specifier, knownSources)).filter(Boolean)]));
const reached = new Set();
const visit = (file) => { if (reached.has(file)) return; reached.add(file); for (const target of graph.get(file) ?? []) visit(target); };
for (const entry of roots) visit(entry);
for (const file of sourceFiles) if (!reached.has(file)) errors.push(`repo verify: unreachable package source (not reached from an export or a test import): ${relative(root, file)}`);

const actualTopLevel = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules').map((entry) => entry.name);
const allowed = new Set(config.allowedTopLevel);
for (const name of actualTopLevel) if (!allowed.has(name)) errors.push(`repo verify: unapproved top-level directory: ${name}`);
for (const name of allowed) if (!existsSync(join(root, name))) warnings.push(`configured top-level directory is currently absent: ${name}`);

const lineCount = (path) => readFileSync(path, 'utf8').split('\n').length;
for (const path of [...sourceFiles, ...walk(join(root, 'registry'), (file) => /\.(?:tsx?|jsx?|mjs)$/.test(file))]) {
  const lines = lineCount(path);
  if (lines > config.sizeWarnings.sourceLines) warnings.push(`large source ${relative(root, path)}: ${lines} lines (warning threshold ${config.sizeWarnings.sourceLines})`);
}
for (const path of walk(join(root, 'test'), (file) => /\.(?:tsx?|jsx?|mjs)$/.test(file))) {
  const lines = lineCount(path);
  if (lines > config.sizeWarnings.testLines) warnings.push(`large test ${relative(root, path)}: ${lines} lines (warning threshold ${config.sizeWarnings.testLines})`);
}

// Existing specialized checks are the single owners of import boundaries, registry reachability/cycles and feature-map validity.
for (const script of ['check-pi-boundary.mjs', 'check-registry-blocks.mjs', 'check-features.mjs']) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', script)], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) errors.push(`${script} failed:\n${(result.stdout ?? '')}${(result.stderr ?? '')}`.trim());
}
for (const warning of warnings) console.warn(`WARN ${warning}`);
if (errors.length) {
  console.error(`verify:repo failed (${errors.length} issue(s))\n${errors.map((error) => `  ${error}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`verify:repo passed: ${actualTopLevel.length} top-level folders, ${sourceFiles.length} package sources reachable from ${roots.size} public/test roots; specialized boundaries and feature map passed.`);
  console.log(`verify:repo emitted ${warnings.length} non-blocking size/layout warning(s).`);
}
