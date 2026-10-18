#!/usr/bin/env node
// Installed registry blocks are generated copies: an app customizes them only through the kit's extension points (registry/README.md,
// "Updating installed blocks"). This command lists the copies an app has edited and reinstalls every installed block at a version.
//
//   npx boring-ui-blocks check  [--dir src/components]
//   npx boring-ui-blocks update [--version 0.3.3] [--dir src/components] [--registry <url>] [--dry-run]
//
// `check` compares each installed block file with the registry item of the installed @hachej/boring-ui-kit (its `r/` folder) and exits 1
// when a file is edited or missing. `update` runs the pinned shadcn CLI with `add <item URLs> --overwrite --yes` for every installed
// block, at `--version` (default: the installed kit). It writes nothing else into the app.
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = '@hachej/boring-ui-kit';
/** The shadcn CLI the registry items are built for (ARCHITECTURE.json `sourceDistribution.format`). */
export const SHADCN = 'shadcn@4.21.5';
export const itemBase = version => `https://cdn.jsdelivr.net/npm/${KIT}@${version}/r`;

/** The installed kit: its version and its registry items that copy files (`theme` has none). */
export function installedKit(app) {
  const root = join(app, 'node_modules', KIT);
  if (!existsSync(join(root, 'package.json'))) throw new Error(`${KIT} is not installed in ${app}`);
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const items = readdirSync(join(root, 'r')).filter(name => name.endsWith('.json') && name !== 'registry.json')
    .map(name => JSON.parse(readFileSync(join(root, 'r', name), 'utf8'))).filter(item => item.files?.length);
  return { version, items };
}

/** Where the blocks were installed: `--dir`, else `src/components`, else `components`. */
export function componentsDir(app, dir) {
  if (dir) return resolve(app, dir);
  return existsSync(join(app, 'src', 'components')) ? join(app, 'src', 'components') : join(app, 'components');
}

// The CLI may drop the `'use client'` directive (a non-RSC app) and an editor may change line endings: neither is an edit.
const normal = text => text.replace(/\r\n/g, '\n').replace(/^(['"])use client\1;?\s*/, '').trimEnd();

/** Each installed block (one of its files exists) and its files that differ from the registry item (`edited`) or are gone (`missing`). */
export function checkBlocks(app, dir) {
  const { version, items } = installedKit(app);
  const base = componentsDir(app, dir);
  const blocks = [];
  for (const item of items) {
    const files = item.files.map(file => ({ file, path: join(base, file.target.replace(/^components\//, '')) }));
    if (!files.some(({ path }) => existsSync(path))) continue;
    const edited = [], missing = [];
    for (const { file, path } of files) {
      if (!existsSync(path)) missing.push(path);
      else if (normal(readFileSync(path, 'utf8')) !== normal(file.content ?? '')) edited.push(path);
    }
    blocks.push({ name: item.name, edited, missing });
  }
  return { version, blocks };
}

function parse(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const name = rest[i].replace(/^--/, '');
    if (name === 'dry-run') flags.dryRun = true;
    else flags[name] = rest[++i];
  }
  return { command, flags };
}

export function main(argv, app = process.cwd(), log = console.log) {
  const { command, flags } = parse(argv);
  if (command === 'check') {
    const { version, blocks } = checkBlocks(app, flags.dir);
    if (!blocks.length) { log(`No ${KIT}@${version} blocks found under ${componentsDir(app, flags.dir)}.`); return 0; }
    let drift = 0;
    for (const block of blocks) {
      for (const path of block.edited) { drift++; log(`edited  ${block.name}  ${path}`); }
      for (const path of block.missing) { drift++; log(`missing ${block.name}  ${path}`); }
    }
    log(drift ? `${drift} file(s) differ from ${KIT}@${version}. Copies are generated: move the change to an extension point, then run \`boring-ui-blocks update\`.`
      : `${blocks.length} block(s) match ${KIT}@${version}: ${blocks.map(block => block.name).join(', ')}.`);
    return drift ? 1 : 0;
  }
  if (command === 'update') {
    const { version: installed, blocks } = checkBlocks(app, flags.dir);
    if (!blocks.length) { log('No installed blocks to update.'); return 1; }
    const base = (flags.registry ?? itemBase(flags.version ?? installed)).replace(/\/$/, '');
    const args = ['-y', SHADCN, 'add', ...blocks.map(block => `${base}/${block.name}.json`), '--overwrite', '--yes'];
    log(`npx ${args.join(' ')}`);
    if (flags.dryRun) return 0;
    const result = spawnSync('npx', args, { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' });
    return result.status ?? 1;
  }
  log('usage: boring-ui-blocks check [--dir <components>] | update [--version <v>] [--dir <components>] [--registry <url>] [--dry-run]');
  return 2;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
