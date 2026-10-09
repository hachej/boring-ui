import { lstatSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const compiler = createRequire(import.meta.url).resolve('typescript/bin/tsc');

/** Delete only declared package-root build output, never source or arbitrary
 * config paths. Validate ALL roots before removing any; refuse symlink aliases.
 * tsc --build --force alone does not remove output of deleted source files.
 */
export function cleanOutputs(root) {
  root = resolve(root);
  const policy = JSON.parse(readFileSync(resolve(root, 'ARCHITECTURE.json'), 'utf8'));
  const paths = [];
  for (const name of Object.keys(policy.packages)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Unsafe package name: ${name}`);
    for (const part of ['packages', `packages/${name}`, `packages/${name}/dist`]) {
      const path = resolve(root, part);
      let info;
      try { info = lstatSync(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Build path is not an owned directory: ${part}`);
    }
    const configuration = resolve(root, 'packages', name, 'tsconfig.json');
    const config = JSON.parse(readFileSync(configuration, 'utf8'));
    if (config.compilerOptions?.rootDir !== 'src' || config.compilerOptions?.outDir !== 'dist' || config.compilerOptions?.tsBuildInfoFile !== 'dist/build.tsbuildinfo') {
      throw new Error(`Undeclared build outputs for ${name}`);
    }
    paths.push(resolve(root, 'packages', name, 'dist'));
  }
  for (const path of paths) rmSync(path, { recursive: true, force: true });
}

export function build(root, { stdio = 'inherit' } = {}) {
  cleanOutputs(root);
  const result = spawnSync(process.execPath, [compiler, '--build', '--force', resolve(root, 'tsconfig.json')], { cwd: root, stdio });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = build(fileURLToPath(new URL('../', import.meta.url)));
}
