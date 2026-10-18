#!/usr/bin/env node
// The kit's one command: an app enforces the kit rules with it and copies no script. The contract (commands, flags, output, exit codes)
// is documented once, in registry/README.md, "Updating installed blocks".
//
//   npx boring-ui-blocks check [--design <dir>...] [--cwd <app web dir>] [--json]
//   npx boring-ui-blocks update [--version <v>] [--registry <url>] [--dry-run] [--cwd <dir>]
//   npx boring-ui-blocks add <shadcn add arguments...> [--cwd <dir>]
//   npx boring-ui-blocks manifest [--cwd <dir>]
//
// `check` writes nothing. `add`, `update` and `manifest` write the shadcn files they install and SHADCN-GENERATED.json, nothing else.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// BORING-UI-1 rule engine, one implementation: this repository's `scripts/check-design.mjs` imports `scanDesign` (DESIGN_RULES) from
// here for the registry and the kit; `check --design` applies APP_RULES to an app's own code. Lexical guard, not a CSS cascade or data-flow
// proof. Layout metrics (gaps, widths, grid tracks, 44px touch targets) match no rule.
const shadow = /(?<![\w-])shadow-(?:xs|sm|md|lg|xl|2xl)(?![\w-])|\b(?:box-shadow|boxShadow)\s*[:=]\s*['"]?(?!\s*(?:var\(|none\b|inherit\b))[0-9.-][^;\n"']*/g;
const radius = /(?<![\w-])rounded(?:-(?:sm|md|lg|xl|2xl|3xl|4xl|full)|-\[(?!var\(|--)[^\]]+\])?(?![\w-])|\b(?:border-radius|borderRadius)\s*:\s*['"]?(?!\s*(?:var\(|inherit\b))(?:[0-9.]|calc\()[^;\n"']*/g;
const borderWidth = /(?<![\w-])border(?:-[trblxyse])?(?:-(?:\d+|\[(?:\d|\.)[^\]]*\]))?(?![\w-]|["']?\s*:)|\b(?:border(?:-[\w]+)?|borderWidth)\s*:\s*['"]?\d+(?:\.\d+)?px\b[^;\n"']*/g;
const color = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\([^)]*\)|\b(?:bg|text|border|ring|fill|stroke|outline|decoration|shadow)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d+)?\b/g;
const font = /\bfont-\[(?!var\(|--)[^\]]+\]|\bfont-family\s*:\s*(?!\s*(?:var\(|inherit\b))[^;\n}]+|\bfontFamily\s*:\s*['"](?!var\()[^'"]+['"]|\bfont\s*:\s*[^;\n}]*\b(?:serif|monospace|system-ui)\b[^;\n}]*/g;

/** The repository's rules (registry blocks and kit sources). */
export const DESIGN_RULES = [
  ['shadow', shadow],
  ['radius', radius],
  ['border-width', borderWidth],
  ['color', color],
  ['font', font],
  ['motion', /\b(?:duration|delay)-\d+\b|\b(?:transition(?:-[\w-]+)?|animation(?:-[\w-]+)?|transitionDuration|animationDuration)\s*:\s*[^;\n}]*?\b\d*\.?\d+m?s\b[^;\n}]*/g],
  ['style', /\bradix(?:-[\w-]+)?\b/gi],
  ['primitive', /\b(?:function|const|class)\s+(?:Button|IconButton|ActionMenu|\w*Popover|\w*Tooltip|\w*Dialog|\w*Menu)\b|<(?:button|input|textarea|select)\b/g],
];

/** An app's own code: the visual rules above, plus arbitrary type/shadow/letter-spacing values and `dark:` variants (theme tokens handle dark). */
export const APP_RULES = [
  ...DESIGN_RULES.filter(([rule]) => ['shadow', 'radius', 'border-width', 'color', 'font'].includes(rule)),
  ['arbitrary-value', /(?<![\w-])(?:text|tracking|leading|shadow)-\[(?!var\(|--)[^\]]+\]|\b(?:font-size|fontSize|letter-spacing|letterSpacing|line-height|lineHeight)\s*:\s*['"]?-?\d*\.?\d+px\b[^;\n"']*/g],
  ['dark', /(?<![\w-])dark:[^\s"'`]+/g],
];

/** Findings `{ file, line, column, rule, value }` of `rules` in `text`; CSS block comments are ignored. */
export function scanDesign(file, text, rules = DESIGN_RULES) {
  const findings = [];
  const source = text.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
  for (const [rule, pattern] of rules) for (const match of source.matchAll(pattern)) {
    const before = text.slice(0, match.index), line = before.split('\n').length;
    findings.push({ file, line, column: match.index - before.lastIndexOf('\n'), rule, value: match[0] });
  }
  return findings;
}

/**
 * An app file under the tokens-only rule. The exception classes of the repository's `scripts/design-allowlist.json` that apply to an app
 * apply by construction, never through an app allowlist: Markdown is content (the command scans code and CSS only) and a CSS custom
 * property declaration (`--primary: oklch(…)`) is the app's theme definition.
 */
export function scanAppDesign(file, text) {
  const lines = text.split('\n');
  const themeValue = ({ line, column }) => file.endsWith('.css') && /--[\w-]+\s*:[^;{}]*$/.test(lines[line - 1].slice(0, column - 1));
  return scanDesign(file, text, APP_RULES).filter(finding => !themeValue(finding));
}

const KIT = '@hachej/boring-ui-kit';
/** The shadcn CLI the registry items are built for (ARCHITECTURE.json `sourceDistribution.format`). */
export const SHADCN = 'shadcn@4.21.5';
/** sha256 of every generated shadcn file under the app's `ui` alias, written by `add`, `update` and `manifest`, verified by `check`. */
export const MANIFEST = 'SHADCN-GENERATED.json';
export const itemBase = version => `https://cdn.jsdelivr.net/npm/${KIT}@${version}/r`;

const posix = path => path.split(sep).join('/');
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Every file under `dir` (recursive, sorted), without node_modules and dot entries. */
function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter(entry => !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : entry.isFile() ? [join(dir, entry.name)] : []);
}

/** The installed kit (its package.json version) and its registry items that copy files (`theme` has none). */
export function installedKit(app) {
  const root = join(app, 'node_modules', KIT);
  if (!existsSync(join(root, 'package.json'))) throw new Error(`${KIT} is not installed in ${app}: the kit version is read from node_modules/${KIT}/package.json`);
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (!version || !existsSync(join(root, 'r'))) throw new Error(`${KIT}@${version ?? '?'} ships no registry items (node_modules/${KIT}/r)`);
  const items = readdirSync(join(root, 'r')).filter(name => name.endsWith('.json') && name !== 'registry.json')
    .map(name => JSON.parse(readFileSync(join(root, 'r', name), 'utf8'))).filter(item => item.files?.length);
  return { version, items };
}

/** Where shadcn writes, from components.json `aliases`: an `@/` alias is `src/` when the app has one, else the app root. */
export function appPaths(app) {
  const file = join(app, 'components.json');
  if (!existsSync(file)) throw new Error(`no components.json in ${app}: run in the app's web directory or pass --cwd`);
  const { aliases = {} } = JSON.parse(readFileSync(file, 'utf8'));
  const dir = alias => join(app, existsSync(join(app, 'src')) ? 'src' : '', alias.replace(/^[@~]\//, ''));
  const components = dir(aliases.components ?? '@/components');
  return { components, ui: aliases.ui ? dir(aliases.ui) : join(components, 'ui') };
}

// The CLI may drop the `'use client'` directive (a non-RSC app) and an editor may change line endings: neither is an edit.
const normal = text => text.replace(/\r\n/g, '\n').replace(/^(['"])use client\1;?\s*/, '').trimEnd();

/** Each installed block (one of its files exists): its files, and those that differ from the registry item (`edited`) or are gone (`missing`). */
export function checkBlocks(app, components = appPaths(app).components) {
  const { version, items } = installedKit(app);
  const blocks = [];
  for (const item of items) {
    const paths = item.files.map(file => ({ file, path: join(components, file.target.replace(/^components\//, '')) }));
    if (!paths.some(({ path }) => existsSync(path))) continue;
    const edited = [], missing = [];
    for (const { file, path } of paths) {
      if (!existsSync(path)) missing.push(path);
      else if (normal(readFileSync(path, 'utf8')) !== normal(file.content ?? '')) edited.push(path);
    }
    blocks.push({ name: item.name, files: paths.map(({ path }) => path), edited, missing });
  }
  return { version, blocks };
}

/** (Re)writes SHADCN-GENERATED.json from the files now under the `ui` alias. */
export function writeManifest(app) {
  const { ui } = appPaths(app);
  const hashes = Object.fromEntries(files(ui).map(path => [posix(relative(ui, path)), sha256(path)]));
  writeFileSync(join(app, MANIFEST), `${JSON.stringify({ generatedBy: 'boring-ui-blocks', dir: posix(relative(app, ui)), files: hashes }, null, 2)}\n`);
  return Object.keys(hashes).length;
}

/** Generated shadcn files edited by hand (`edited`), present but not in the manifest (`unrecorded`) or deleted (`missing`). */
export function checkUi(app) {
  const { ui } = appPaths(app);
  const recorded = existsSync(join(app, MANIFEST)) ? JSON.parse(readFileSync(join(app, MANIFEST), 'utf8')).files ?? {} : {};
  const present = new Map(files(ui).map(path => [posix(relative(ui, path)), path]));
  const found = [];
  for (const [name, path] of present) {
    if (!(name in recorded)) found.push({ rule: 'unrecorded', path });
    else if (recorded[name] !== sha256(path)) found.push({ rule: 'edited', path });
  }
  for (const name of Object.keys(recorded)) if (!present.has(name)) found.push({ rule: 'missing', path: join(ui, name) });
  return found;
}

/** Tokens-only findings in the app's own code under `dirs`, skipping generated shadcn files and installed block files. */
export function checkDesign(app, dirs, skip) {
  const { ui } = appPaths(app);
  const findings = [];
  for (const dir of dirs) {
    const base = resolve(app, dir);
    if (!existsSync(base)) throw new Error(`--design ${dir}: no such directory in ${app}`);
    for (const path of files(base)) {
      if (!/\.(?:[cm]?[jt]sx?|css)$/.test(path) || skip.has(path) || path.startsWith(ui + sep)) continue;
      findings.push(...scanAppDesign(posix(relative(app, path)), readFileSync(path, 'utf8')).sort((a, b) => a.line - b.line || a.column - b.column));
    }
  }
  return findings;
}

/** Every rule the kit enforces in an app: `{ version, blocks, violations }`, each violation `{ check, rule, file, line?, column?, detail }`. */
export function check(app, design = []) {
  const { components } = appPaths(app);
  const { version, blocks } = checkBlocks(app, components);
  const rel = path => posix(relative(app, path));
  const violations = [];
  for (const block of blocks) {
    for (const path of block.edited) violations.push({ check: 'blocks', rule: 'edited', file: rel(path), detail: block.name });
    for (const path of block.missing) violations.push({ check: 'blocks', rule: 'missing', file: rel(path), detail: block.name });
  }
  if (design.length) for (const finding of checkDesign(app, design, new Set(blocks.flatMap(block => block.files)))) {
    violations.push({ check: 'design', rule: finding.rule, file: finding.file, line: finding.line, column: finding.column, detail: finding.value });
  }
  for (const { rule, path } of checkUi(app)) violations.push({ check: 'ui', rule, file: rel(path), detail: MANIFEST });
  return { version, blocks: blocks.map(block => block.name), violations };
}

const USAGE = 'usage: boring-ui-blocks check [--design <dir>...] [--cwd <dir>] [--json] | update [--version <v>] [--registry <url>] [--dry-run] [--cwd <dir>] | add <shadcn add args...> [--cwd <dir>] | manifest [--cwd <dir>]';
const FLAGS = { check: ['design', 'cwd', 'json'], update: ['version', 'registry', 'dry-run', 'cwd'], manifest: ['cwd'] };

function parse(command, rest) {
  const flags = { design: [], pass: [] };
  for (let i = 0; i < rest.length; i++) {
    const name = rest[i].startsWith('--') ? rest[i].slice(2) : null;
    if (command === 'add' && name !== 'cwd') { flags.pass.push(rest[i]); continue; }
    if (!name || !FLAGS[command]?.includes(name) && name !== 'cwd') throw new Error(`unknown argument ${rest[i]}`);
    if (name === 'json') flags.json = true;
    else if (name === 'dry-run') flags.dryRun = true;
    else if (name === 'design') {
      while (rest[i + 1] && !rest[i + 1].startsWith('--')) flags.design.push(rest[++i]);
      if (!flags.design.length) throw new Error('--design needs at least one directory');
    } else if (rest[i + 1] === undefined || rest[i + 1].startsWith('--')) throw new Error(`--${name} needs a value`);
    else flags[name] = rest[++i];
  }
  return flags;
}

function shadcnAdd(app, args, log) {
  const argv = ['-y', SHADCN, 'add', ...args];
  log(`npx ${argv.join(' ')}`);
  const result = spawnSync('npx', argv, { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' });
  return result.status ?? 1;
}

const line = v => `${v.check} ${v.rule} ${v.file}${v.line ? `:${v.line}:${v.column}` : ''} ${v.detail}`;

export function main(argv, cwd = process.cwd(), log = console.log, error = console.error) {
  const [command, ...rest] = argv;
  let flags;
  try {
    if (!['check', 'update', 'add', 'manifest'].includes(command)) throw new Error(command ? `unknown command ${command}` : 'missing command');
    flags = parse(command, rest);
    const app = resolve(cwd, flags.cwd ?? '.');
    if (command === 'check') {
      const result = check(app, flags.design);
      if (flags.json) { log(JSON.stringify({ ok: !result.violations.length, kit: `${KIT}@${result.version}`, ...result }, null, 2)); return result.violations.length ? 1 : 0; }
      for (const violation of result.violations) log(line(violation));
      const counts = ['blocks', 'design', 'ui'].map(name => `${name} ${result.violations.filter(v => v.check === name).length}`).join(', ');
      if (!result.violations.length) { log(`ok ${KIT}@${result.version}: ${result.blocks.length} block(s), design ${flags.design.length ? flags.design.join(' ') : 'not checked'}, ${MANIFEST} matches`); return 0; }
      log(`fail ${KIT}@${result.version}: ${result.violations.length} violation(s) (${counts}). Blocks and ui files are generated: move a change to an extension point or the theme, then run \`boring-ui-blocks update\`; fix design violations in the app, never the rule.`);
      return 1;
    }
    if (command === 'manifest') { log(`${MANIFEST}: ${writeManifest(app)} file(s)`); return 0; }
    if (command === 'add') {
      appPaths(app);
      if (!flags.pass.length) throw new Error('add needs shadcn add arguments');
      const status = shadcnAdd(app, flags.pass, log);
      if (status === 0) log(`${MANIFEST}: ${writeManifest(app)} file(s)`);
      return status;
    }
    const { version: installed, blocks } = checkBlocks(app);
    if (!blocks.length) throw new Error('no installed blocks to update');
    const base = (flags.registry ?? itemBase(flags.version ?? installed)).replace(/\/$/, '');
    const items = blocks.map(block => `${base}/${block.name}.json`);
    if (flags.dryRun) { log(`npx -y ${SHADCN} add ${items.join(' ')} --overwrite --yes`); return 0; }
    const status = shadcnAdd(app, [...items, '--overwrite', '--yes'], log);
    if (status === 0) log(`${MANIFEST}: ${writeManifest(app)} file(s)`);
    return status;
  } catch (cause) {
    if (flags?.json) log(JSON.stringify({ ok: false, error: cause.message }, null, 2));
    else error(`error: ${cause.message}\n${USAGE}`);
    return 2;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
