#!/usr/bin/env node
// The kit's one command: an app enforces the kit rules with it and copies no script. The contract (commands, flags, output, exit codes)
// is documented once, in registry/README.md, "Updating installed blocks".
//
//   npx boring-ui-blocks check [--design <dir>...] [--manifest <path>] [--cwd <app web dir>] [--json]
//   npx boring-ui-blocks update [--version <v>] [--registry <url>] [--dry-run] [--manifest <path>] [--cwd <dir>]
//   npx boring-ui-blocks add <shadcn add arguments...> [--manifest <path>] [--cwd <dir>]
//   npx boring-ui-blocks manifest [--manifest <path>] [--cwd <dir>]
//   npx boring-ui-blocks help    (also --help: the usage and which items to add; exit 0)
//
// `check` writes nothing. `add`, `update` and `manifest` write the shadcn files they install and the manifest, nothing else.
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

/**
 * The app profile of the same engine. Blocks pick no radius, border or shadow at all (DESIGN_RULES); an app's own code may use the
 * utilities that resolve to theme variables (`rounded-md`, `border`, `border-t`, `shadow-md`, `text-sm`) and fails on literals:
 * colour literals and palette classes, arbitrary visual values, other border widths, font families, literal radius/shadow/font-size/
 * letter-spacing/border-width declarations (a 1px border equals the `border` utility) and `dark:` variants (the theme's `.dark` tokens).
 */
const LENGTH = String.raw`(?<![\w.#-])(?!1px\b)\d*\.?\d+(?:px|rem|em)\b`;
export const APP_RULES = [
  ['color', color],
  ['arbitrary-value', /(?<![\w-])(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|fill|stroke|decoration|shadow|drop-shadow|inset-shadow|rounded(?:-[trblse]{1,2})?|font|tracking|leading|from|via|to|divide(?:-[xy])?|placeholder|caret|accent)-\[(?!var\(|--|#|(?:rgb|rgba|hsl|hsla|oklch|oklab)\()[^\]]+\]/g],
  ['border-width', /(?<![\w-])border(?:-[trblxyse])?-(?!0(?![\w.]))\d+(?![\w-])/g],
  ['border-width', new RegExp(String.raw`\b(?:border(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?(?:-width)?|border(?:Top|Right|Bottom|Left)?Width|border(?:Top|Right|Bottom|Left)?)\s*:\s*['"]?(?=[^;\n}"']*?${LENGTH})[^;\n}"']*`, 'g')],
  ['font', /\bfont-family\s*:\s*(?!\s*(?:var\(|inherit\b))[^;\n}]+|\bfontFamily\s*:\s*['"](?!var\()[^'"]+['"]|\bfont\s*:\s*(?!\s*(?:var\(|inherit\b))[^;\n}]+/g],
  ['literal-value', /\b(?:border-radius|borderRadius|box-shadow|boxShadow|font-size|fontSize|letter-spacing|letterSpacing)\s*:\s*['"]?(?!\s*(?:var\(|calc\(\s*var\(|inherit\b|initial\b|unset\b|none\b|0(?![\w.])))(?=[^;\n}"']*\d)[^;\n}"']*/g],
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

/** Offset ranges of the CSS token definition blocks (`:root`, `.dark`, `@theme`, `@layer theme`): the only place an app's CSS holds values. */
function tokenBlocks(css) {
  const ranges = [], stack = [];
  let start = 0;
  const token = prelude => /^@theme\b|^@layer\s+theme\b/.test(prelude)
    || prelude.split(',').every(part => /^(?::root|html|\.dark|:root\.dark|html\.dark|:root:not\(\.dark\)|\[data-theme[^\]]*\])$/.test(part.trim()));
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') { stack.push({ open: i, token: token(css.slice(start, i).trim()) || stack.at(-1)?.token }); start = i + 1; }
    else if (css[i] === '}') { const block = stack.pop(); if (block?.token && !stack.at(-1)?.token) ranges.push([block.open, i]); start = i + 1; }
    else if (css[i] === ';') start = i + 1;
  }
  return ranges;
}

/**
 * An app file under APP_RULES. The repository's exception classes that apply to an app apply by construction, never through an app
 * allowlist: Markdown is content (the command scans code and CSS only) and a CSS token definition block is the app's theme.
 */
export function scanAppDesign(file, text) {
  if (!file.endsWith('.css')) return scanDesign(file, text, APP_RULES);
  const source = text.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
  const ranges = tokenBlocks(source), starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return scanDesign(file, text, APP_RULES).filter(({ line, column }) => {
    const offset = starts[line - 1] + column - 1;
    return !ranges.some(([open, close]) => offset > open && offset < close);
  });
}

const KIT = '@hachej/boring-ui-kit';
/** The shadcn CLI the registry items are built for (ARCHITECTURE.json `sourceDistribution.format`). */
export const SHADCN = 'shadcn@4.21.5';
/** sha256 of every generated shadcn file under the app's `ui` alias, written by `add`, `update` and `manifest`, verified by `check`. */
export const MANIFEST = 'SHADCN-GENERATED.json';
export const itemBase = version => `https://cdn.jsdelivr.net/npm/${KIT}@${version}/r`;

const posix = path => path.split(sep).join('/');
// sha256 of a file's text with line endings normalised (a checkout may convert them).
const sha256 = path => createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

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
// The CLI also drops the leading comment of a file it writes. The rest of the file must match exactly.
const preamble = /^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/|(['"])use client\1;?))*\s*/;
const normal = text => text.replace(/\r\n/g, '\n').replace(preamble, '').trimEnd();

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

/** The generated shadcn files under the `ui` alias (`.js/.jsx/.ts/.tsx/.css`) and their sha256, by path relative to it. */
const uiHashes = ui => new Map(files(ui).filter(path => /\.(?:[jt]sx?|css)$/.test(path)).map(path => [posix(relative(ui, path)), { path, hash: sha256(path) }]));

/** (Re)writes the manifest (`manifest`, default SHADCN-GENERATED.json next to components.json): `files` is replaced, other keys are kept. */
export function writeManifest(app, manifest = MANIFEST) {
  const { ui } = appPaths(app);
  const path = resolve(app, manifest);
  const hashes = Object.fromEntries([...uiHashes(ui)].map(([name, { hash }]) => [name, hash]));
  const kept = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { generatedBy: 'boring-ui-blocks', dir: posix(relative(app, ui)) };
  writeFileSync(path, `${JSON.stringify({ ...kept, files: hashes }, null, 2)}\n`);
  return Object.keys(hashes).length;
}

/** Generated shadcn files edited by hand (`edited`), present but not in the manifest (`unrecorded`) or deleted (`missing`). */
export function checkUi(app, manifest = MANIFEST) {
  const { ui } = appPaths(app);
  const path = resolve(app, manifest);
  const recorded = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).files ?? {} : {};
  const present = uiHashes(ui);
  const found = [];
  for (const [name, file] of present) {
    if (!(name in recorded)) found.push({ rule: 'unrecorded', path: file.path });
    else if (recorded[name] !== file.hash) found.push({ rule: 'edited', path: file.path });
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
export function check(app, design = [], manifest = MANIFEST) {
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
  for (const { rule, path } of checkUi(app, manifest)) violations.push({ check: 'ui', rule, file: rel(path), detail: posix(manifest) });
  return { version, blocks: blocks.map(block => block.name), violations };
}

const USAGE = `usage: boring-ui-blocks check [--design <dir>...] [--manifest <path>] [--cwd <dir>] [--json] | update [--version <v>] [--registry <url>] [--dry-run] [--manifest <path>] [--cwd <dir>] | add <shadcn add args...> [--manifest <path>] [--cwd <dir>] | manifest [--manifest <path>] [--cwd <dir>] | help\n\n` +
  'Blocks: pi-app is the whole agent app with every chat feature and viewer. pi-chat is the core chat only: add pi-chat-plugins for every ' +
  'feature, or one of pi-chat-markdown, pi-chat-slash, pi-chat-mentions, pi-chat-pickers, pi-chat-voice, pi-chat-attachments, ' +
  'pi-chat-question, pi-chat-approval, pi-chat-subagent and pi-artifacts. Viewers are viewer-frame plus viewer-markdown, viewer-html, ' +
  'viewer-image, viewer-pdf and viewer-code, loaded by kind. update reinstalls only installed items: ' +
  'add the new ones an app uses once (registry/README.md, "From one item to small items").';
const FLAGS = { check: ['design', 'manifest', 'json'], update: ['version', 'registry', 'dry-run', 'manifest'], manifest: ['manifest'] };

function parse(command, rest) {
  const flags = { design: [], pass: [] };
  for (let i = 0; i < rest.length; i++) {
    const name = rest[i].startsWith('--') ? rest[i].slice(2) : null;
    if (command === 'add' && name !== 'cwd' && name !== 'manifest') { flags.pass.push(rest[i]); continue; }
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

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const readJson = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; } };

/** The version specifiers of an app's package.json (and the root entry of its npm lockfile), as written before the CLI runs. */
function specifiers(app) {
  const read = name => { const path = join(app, name), text = existsSync(path) ? readFileSync(path, 'utf8') : undefined; return { path, text, json: text === undefined ? undefined : readJson(path) }; };
  return [read('package.json'), read('package-lock.json')].map((file, index) => ({ ...file, root: index === 0 ? file.json : file.json?.packages?.[''] }));
}

/**
 * The shadcn CLI installs a block's dependencies by name (`npm install <name>`), and npm then saves `^<version>` over an exact pin the app
 * already holds. The app owns its specifiers (AGENTS.md: pin dependencies), so after the CLI ran every dependency that was there before
 * gets its old specifier back, in package.json and in the lockfile's root entry; dependencies the CLI added keep what it wrote.
 */
function restoreSpecifiers(before, app, log) {
  const restored = new Set();
  for (const [index, name] of ['package.json', 'package-lock.json'].entries()) {
    const old = before[index], now = specifiers(app)[index];
    if (!old.root || !now.root) continue;
    for (const field of DEPENDENCY_FIELDS) for (const [dependency, range] of Object.entries(old.root[field] ?? {})) {
      if (now.root[field]?.[dependency] !== undefined && now.root[field][dependency] !== range) { now.root[field][dependency] = range; restored.add(dependency); now.changed = true; }
    }
    if (now.changed) writeFileSync(now.path, `${JSON.stringify(now.json, null, /^\{\n([ \t]+)"/.exec(now.text)?.[1] ?? 2)}${now.text.endsWith('\n') ? '\n' : ''}`);
  }
  if (restored.size) log(`kept the version specifiers of ${[...restored].sort().join(', ')} (the CLI had rewritten them)`);
}

function shadcnAdd(app, args, log) {
  const argv = ['-y', SHADCN, 'add', ...args];
  log(`npx ${argv.join(' ')}`);
  const before = specifiers(app);
  const result = spawnSync('npx', argv, { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' });
  restoreSpecifiers(before, app, log);
  return result.status ?? 1;
}

const line = v => `${v.check} ${v.rule} ${v.file}${v.line ? `:${v.line}:${v.column}` : ''} ${v.detail}`;

export function main(argv, cwd = process.cwd(), log = console.log, error = console.error) {
  const [command, ...rest] = argv;
  if (['help', '--help', '-h'].includes(command)) { log(USAGE); return 0; }
  let flags;
  try {
    if (!['check', 'update', 'add', 'manifest'].includes(command)) throw new Error(command ? `unknown command ${command}` : 'missing command');
    flags = parse(command, rest);
    const app = resolve(cwd, flags.cwd ?? '.');
    if (command === 'check') {
      const manifest = flags.manifest ?? MANIFEST;
      const result = check(app, flags.design, manifest);
      if (flags.json) { log(JSON.stringify({ ok: !result.violations.length, kit: `${KIT}@${result.version}`, ...result }, null, 2)); return result.violations.length ? 1 : 0; }
      for (const violation of result.violations) log(line(violation));
      const counts = ['blocks', 'design', 'ui'].map(name => `${name} ${result.violations.filter(v => v.check === name).length}`).join(', ');
      if (!result.violations.length) { log(`ok ${KIT}@${result.version}: ${result.blocks.length} block(s), design ${flags.design.length ? flags.design.join(' ') : 'not checked'}, ${posix(manifest)} matches`); return 0; }
      log(`fail ${KIT}@${result.version}: ${result.violations.length} violation(s) (${counts}). Blocks and ui files are generated: move a change to an extension point or the theme, then run \`boring-ui-blocks update\`; fix design violations in the app, never the rule.`);
      return 1;
    }
    if (command === 'manifest') { log(`${flags.manifest ?? MANIFEST}: ${writeManifest(app, flags.manifest)} file(s)`); return 0; }
    if (command === 'add') {
      appPaths(app);
      if (!flags.pass.length) throw new Error('add needs shadcn add arguments');
      const status = shadcnAdd(app, flags.pass, log);
      if (status === 0) log(`${flags.manifest ?? MANIFEST}: ${writeManifest(app, flags.manifest)} file(s)`);
      return status;
    }
    const { version: installed, blocks } = checkBlocks(app);
    if (!blocks.length) throw new Error('no installed blocks to update');
    const base = (flags.registry ?? itemBase(flags.version ?? installed)).replace(/\/$/, '');
    const items = blocks.map(block => `${base}/${block.name}.json`);
    if (flags.dryRun) { log(`npx -y ${SHADCN} add ${items.join(' ')} --overwrite --yes`); return 0; }
    const status = shadcnAdd(app, [...items, '--overwrite', '--yes'], log);
    if (status === 0) log(`${flags.manifest ?? MANIFEST}: ${writeManifest(app, flags.manifest)} file(s)`);
    return status;
  } catch (cause) {
    if (flags?.json) log(JSON.stringify({ ok: false, error: cause.message }, null, 2));
    else error(`error: ${cause.message}\n${USAGE}`);
    return 2;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
