#!/usr/bin/env node
// The kit's one command: an app enforces the kit rules with it and copies no script. The contract (commands, flags, output, exit codes)
// is documented once, in registry/README.md, "Updating installed blocks".
//
//   npx boring-ui-blocks check [--design <dir>...] [--manifest <path>] [--cwd <app web dir>] [--json]
//   npx boring-ui-blocks design <dir> [--changed <file>...] [--json] [--exceptions <file>] [--baseline]   (the one design check of an app's web/src; needs no components.json)
//   npx boring-ui-blocks update [--version <v>] [--registry <url>] [--dry-run] [--manifest <path>] [--cwd <dir>]
//   npx boring-ui-blocks add <shadcn add arguments...> [--overwrite] [--manifest <path>] [--cwd <dir>]
//   npx boring-ui-blocks manifest [--manifest <path>] [--cwd <dir>]
//   npx boring-ui-blocks help    (also --help: the usage and which items to add; exit 0)
//
// `check` writes nothing. `add`, `update` and `manifest` write the shadcn files they install and the manifest, nothing else.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
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

/**
 * `design-no-x-scroll`: a file that renders a table holds no horizontal scroll container (`overflow-x-auto`, `overflow-x-scroll`, the
 * CSS or React style property). Tables truncate their cells and stack below their container width instead. Lexical and file-scoped: the
 * shadcn `table` wrapper (`overflow-x-auto`) must not be imported by a file that renders a table.
 */
const tableMarkup = /<table\b|<Table\b|@\/components\/ui\/table\b|\bDataTable\b|role=["']table["']|\bdisplay\s*:\s*['"]?table\b/;
const horizontalScroll = /(?<![\w-])overflow-x-(?:auto|scroll)(?![\w-])|\boverflowX\s*:\s*['"]?(?:auto|scroll)\b|\boverflow-x\s*:\s*(?:auto|scroll)\b/g;
export function noXScroll(source) {
  return tableMarkup.test(source) ? [...source.matchAll(horizontalScroll)].map(match => ({ index: match.index, value: match[0] })) : [];
}


// The flat card: a Card's own className carries no border, shadow or ring. The shadcn Card's ring lives in its generated file, which blocks never restyle.
const cardFlat = /<Card\b[^>]*?\bclassName\s*=\s*(?:"[^"]*\b(?:border|shadow|ring)\b[^"]*"|\{[^}\n]*\b(?:border|shadow|ring)\b[^}\n]*\})/g;

/** `<Card` tags opened inside another open `<Card>` (a self-closing Card and a Card in a prop are not nesting). Lexical, over JSX tags. */
function nestedCards(source) {
  const found = [], open = [], tag = /<(\/?)Card\b/g;
  for (let match; (match = tag.exec(source));) {
    if (match[1]) { open.pop(); continue; }
    let depth = 0, quote = null, end = match.index + match[0].length;
    for (; end < source.length; end++) {
      const char = source[end];
      if (quote) { if (char === quote) quote = null; }
      else if (/["'`]/.test(char)) quote = char;
      else if (char === '{') depth++;
      else if (char === '}') depth--;
      else if (char === '>' && depth === 0) break;
    }
    if (open.length) found.push({ index: match.index, value: source.slice(match.index, end + 1).split('\n')[0] });
    if (source[end - 1] !== '/') open.push(match.index);
    tag.lastIndex = end + 1;
  }
  return found;
}

/** The repository's rules (registry blocks and kit sources). A rule is a global regex, or a function from the source to `{ index, value }` findings. */
export const DESIGN_RULES = [
  ['design-card-flat', cardFlat],
  ['design-no-nested-card', nestedCards],
  ['shadow', shadow],
  ['radius', radius],
  ['border-width', borderWidth],
  ['color', color],
  ['font', font],
  ['motion', /\b(?:duration|delay)-\d+\b|\b(?:transition(?:-[\w-]+)?|animation(?:-[\w-]+)?|transitionDuration|animationDuration)\s*:\s*[^;\n}]*?\b\d*\.?\d+m?s\b[^;\n}]*/g],
  ['style', /\bradix(?:-[\w-]+)?\b/gi],
  ['primitive', /\b(?:function|const|class)\s+(?:Button|IconButton|ActionMenu|\w*Popover|\w*Tooltip|\w*Dialog|\w*Menu)\b|<(?:button|input|textarea|select)\b/g],
  ['design-no-x-scroll', noXScroll],
];

/**
 * The app profile of the same engine. Blocks pick no radius, border or shadow at all (DESIGN_RULES); an app's own code may use the
 * utilities that resolve to theme variables (`rounded-md`, `border`, `border-t`, `shadow-md`, `text-sm`) and fails on literals:
 * colour literals and palette classes, arbitrary visual values, other border widths, font families, literal radius/shadow/font-size/
 * letter-spacing/border-width declarations (a 1px border equals the `border` utility) and `dark:` variants (the theme's `.dark` tokens).
 */
const LENGTH = String.raw`(?<![\w.#-])(?!1px\b)\d*\.?\d+(?:px|rem|em)\b`;
export const APP_RULES = [
  ['design-card-flat', cardFlat],
  ['design-no-nested-card', nestedCards],
  ['color', color],
  ['arbitrary-value', /(?<![\w-])(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|fill|stroke|decoration|shadow|drop-shadow|inset-shadow|rounded(?:-[trblse]{1,2})?|font|tracking|leading|from|via|to|divide(?:-[xy])?|placeholder|caret|accent)-\[(?!var\(|--|#|(?:rgb|rgba|hsl|hsla|oklch|oklab)\()[^\]]+\]/g],
  ['border-width', /(?<![\w-])border(?:-[trblxyse])?-(?!0(?![\w.]))\d+(?![\w-])/g],
  ['border-width', new RegExp(String.raw`\b(?:border(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?(?:-width)?|border(?:Top|Right|Bottom|Left)?Width|border(?:Top|Right|Bottom|Left)?)\s*:\s*['"]?(?=[^;\n}"']*?${LENGTH})[^;\n}"']*`, 'g')],
  ['font', /\bfont-family\s*:\s*(?!\s*(?:var\(|inherit\b))[^;\n}]+|\bfontFamily\s*:\s*['"](?!var\()[^'"]+['"]|\bfont\s*:\s*(?!\s*(?:var\(|inherit\b))[^;\n}]+/g],
  ['literal-value', /\b(?:border-radius|borderRadius|box-shadow|boxShadow|font-size|fontSize|letter-spacing|letterSpacing)\s*:\s*['"]?(?!\s*(?:var\(|calc\(\s*var\(|inherit\b|initial\b|unset\b|none\b|0(?![\w.])))(?=[^;\n}"']*\d)[^;\n}"']*/g],
  ['dark', /(?<![\w-])dark:[^\s"'`]+/g],
  ['design-no-x-scroll', noXScroll],
];

/** Findings `{ file, line, column, rule, value }` of `rules` in `text`; CSS block comments are ignored. */
export function scanDesign(file, text, rules = DESIGN_RULES) {
  const findings = [];
  const source = text.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
  for (const [rule, pattern] of rules) {
    const matches = typeof pattern === 'function' ? pattern(source) : [...source.matchAll(pattern)].map(match => ({ index: match.index, value: match[0] }));
    for (const { index, value } of matches) {
      const before = text.slice(0, index), line = before.split('\n').length;
      findings.push({ file, line, column: index - before.lastIndexOf('\n'), rule, value });
    }
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
export const SHADCN = 'shadcn@4.23.0';
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

/** Records the given generated ui files in the manifest (`add` after a kept file: only what it created). Other entries and keys are kept. */
export function recordFiles(app, paths, manifest = MANIFEST) {
  const { ui } = appPaths(app);
  const path = resolve(app, manifest);
  const kept = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { generatedBy: 'boring-ui-blocks', dir: posix(relative(app, ui)) };
  const hashes = { ...kept.files };
  for (const file of paths) hashes[posix(relative(ui, file))] = sha256(file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...kept, files: Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b))) }, null, 2)}\n`);
}

/** (Re)writes the manifest (`manifest`, default SHADCN-GENERATED.json next to components.json): `files` is replaced, other keys are kept. */
export function writeManifest(app, manifest = MANIFEST) {
  const { ui } = appPaths(app);
  const path = resolve(app, manifest);
  const hashes = Object.fromEntries([...uiHashes(ui)].map(([name, { hash }]) => [name, hash]));
  const kept = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { generatedBy: 'boring-ui-blocks', dir: posix(relative(app, ui)) };
  mkdirSync(dirname(path), { recursive: true });
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

const USAGE = `usage: boring-ui-blocks design <dir> [--changed <file>...] [--json] [--exceptions <file>] [--baseline] | check [--design <dir>...] [--manifest <path>] [--cwd <dir>] [--json] | update [--version <v>] [--registry <url>] [--dry-run] [--manifest <path>] [--cwd <dir>] | add <shadcn add args...> [--overwrite] [--manifest <path>] [--cwd <dir>] | manifest [--manifest <path>] [--cwd <dir>] | help\n\n` +
  'Blocks: pi-app is the whole agent app with every chat feature and viewer. pi-chat is the core chat only: add pi-chat-plugins for every ' +
  'feature, or one of pi-chat-markdown, pi-chat-slash, pi-chat-mentions, pi-chat-pickers, pi-chat-voice, pi-chat-attachments, ' +
  'pi-chat-question, pi-chat-approval, pi-chat-subagent and pi-artifacts. Viewers are viewer-frame plus viewer-markdown, viewer-html, ' +
  'viewer-image, viewer-pdf and viewer-code, loaded by kind. update reinstalls only installed items: ' +
  'add the new ones an app uses once (registry/README.md, "From one item to small items"). add never prompts: a file that already exists ' +
  'with other content is kept and listed (exit 1) unless --overwrite replaces it; identical files are left alone.';
const FLAGS = { check: ['design', 'manifest', 'json'], update: ['version', 'registry', 'dry-run', 'manifest'], manifest: ['manifest'], add: ['manifest', 'overwrite'] };

function parse(command, rest) {
  const flags = { design: [], pass: [] };
  for (let i = 0; i < rest.length; i++) {
    const name = rest[i].startsWith('--') ? rest[i].slice(2) : null;
    if (command === 'add' && (name === 'overwrite' || rest[i] === '-o')) { flags.overwrite = true; continue; }
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

/** The files the shadcn CLI may write for a block (the components, ui, lib and hooks aliases) and their bytes, before it runs. */
function snapshotFiles(app) {
  const { aliases = {} } = readJson(join(app, 'components.json')) ?? {};
  const alias = (name, fallback) => join(app, existsSync(join(app, 'src')) ? 'src' : '', (aliases[name] ?? fallback).replace(/^[@~]\//, ''));
  const { components, ui } = appPaths(app);
  return new Map([...new Set([components, ui, alias('lib', '@/lib'), alias('hooks', '@/hooks')])].flatMap(dir => files(dir)).map(path => [path, readFileSync(path)]));
}

/**
 * Runs the shadcn CLI without a terminal: stdin is closed and the CLI always gets `--overwrite --yes`, so it never asks. With
 * `overwrite` false a file that existed with other content is put back afterwards and returned in `skipped`; identical files are never touched.
 * `created` is the generated ui files the run newly wrote.
 */
function shadcnAdd(app, args, log, overwrite) {
  const argv = ['-y', SHADCN, 'add', ...args.filter(arg => !['--yes', '-y', '--overwrite'].includes(arg)), '--overwrite', '--yes'];
  log(`npx ${argv.join(' ')}`);
  const before = specifiers(app), existing = snapshotFiles(app);
  const result = spawnSync('npx', argv, { cwd: app, stdio: ['ignore', 'inherit', 'inherit'], shell: process.platform === 'win32' });
  restoreSpecifiers(before, app, log);
  const skipped = overwrite ? [] : [...existing].filter(([path, bytes]) => existsSync(path) && !readFileSync(path).equals(bytes));
  for (const [path, bytes] of skipped) writeFileSync(path, bytes);
  const { ui } = appPaths(app);
  const created = files(ui).filter(path => /\.(?:[jt]sx?|css)$/.test(path) && !existing.has(path));
  return { status: result.status ?? 1, skipped: skipped.map(([path]) => path), created };
}

/**
 * A package manager follows a symlinked `node_modules` or scope directory and writes into the tree it points at: another checkout's install.
 * Refused before anything runs. Per-package links (workspaces, pnpm) stay valid, and `check` never gets here: it writes nothing.
 */
function refuseBorrowedInstall(app) {
  const borrowed = [];
  for (const dir of installRoots(app)) {
    const modules = join(dir, 'node_modules');
    const stat = lstatSync(modules, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) borrowed.push(modules);
    else if (stat) borrowed.push(...readdirSync(modules).filter(name => name.startsWith('@')).map(name => join(modules, name)).filter(path => lstatSync(path).isSymbolicLink()));
  }
  if (borrowed.length) throw new Error(`refusing to install through a borrowed install: ${borrowed.map(path => `${path} is a symlink`).join(', ')}. A package manager would write into the tree it points at. A borrowed install is read-only: \`check\` still works, and \`add\` and \`update\` need an owned physical install.`);
}

/** Where a package manager run from `app` may write: the app, and every directory up to its workspace root when it is in a workspace. */
function installRoots(app) {
  const walked = [];
  for (let dir = app; ; dir = dirname(dir)) {
    walked.push(dir);
    if (isWorkspaceRoot(dir)) return walked;
    if (dirname(dir) === dir) return [app];
  }
}

function isWorkspaceRoot(dir) {
  if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return true;
  try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).workspaces !== undefined; }
  catch { return false; }
}

const line = v => `${v.check} ${v.rule} ${v.file}${v.line ? `:${v.line}:${v.column}` : ''} ${v.detail}`;

export function main(argv, cwd = process.cwd(), log = console.log, error = console.error) {
  const [command, ...rest] = argv;
  if (['help', '--help', '-h'].includes(command)) { log(USAGE); return 0; }
  if (command === 'design') return designMain(rest, cwd, log, error);
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
    if (command === 'add' || (command === 'update' && !flags.dryRun)) refuseBorrowedInstall(app);
    if (command === 'add') {
      appPaths(app);
      if (!flags.pass.length) throw new Error('add needs shadcn add arguments');
      const { status, skipped, created } = shadcnAdd(app, flags.pass, log, flags.overwrite);
      if (skipped.length) {
        // The files the run created are the app's new generated files: record them, so `check` does not call them unknown. The kept ones stay unrecorded.
        if (created.length) recordFiles(app, created, flags.manifest ?? MANIFEST);
        error(`kept ${skipped.length} existing file(s) that differ from the registry (pass --overwrite to replace them; only the files add created were recorded in the manifest):\n${skipped.map(path => `  ${posix(relative(app, path))}`).join('\n')}`);
        return status || 1;
      }
      if (status === 0) log(`${flags.manifest ?? MANIFEST}: ${writeManifest(app, flags.manifest)} file(s)`);
      return status;
    }
    const { version: installed, blocks } = checkBlocks(app);
    if (!blocks.length) throw new Error('no installed blocks to update');
    const base = (flags.registry ?? itemBase(flags.version ?? installed)).replace(/\/$/, '');
    const items = blocks.map(block => `${base}/${block.name}.json`);
    if (flags.dryRun) { log(`npx -y ${SHADCN} add ${items.join(' ')} --overwrite --yes`); return 0; }
    const { status } = shadcnAdd(app, items, log, true);
    if (status === 0) log(`${flags.manifest ?? MANIFEST}: ${writeManifest(app, flags.manifest)} file(s)`);
    return status;
  } catch (cause) {
    if (flags?.json) log(JSON.stringify({ ok: false, error: cause.message }, null, 2));
    else error(`error: ${cause.message}\n${USAGE}`);
    return 2;
  }
}

// ---- `design`: the one design check of an app (D-1789) ---------------------------------------------------------------------------
// The kit's one design check: `boring-ui-blocks design <dir>` (D-1789). Every Boring app runs it on its web/src; Factory's verify calls
// it instead of a copy of the template script. Dependency-free and lexical: it reads text, it does not run the app. It needs no
// components.json and no copied shadcn files: a bundle app imports @boring/ui/shadcn/* and @boring/ui/blocks/*.
//
//   boring-ui-blocks design <dir> [--changed <file>...] [--json] [--exceptions <file>] [--baseline]
//
// Output: one `[warning ]file:line rule message` per finding (paths relative to the working directory), exit 1 on any error. `--json`
// prints { ok, errors, warnings, counts, findings } with each finding { file, line, rule, level, message }. `--changed` keeps only
// the findings of the listed files. A path listed in platform.json `paths` (found in <dir> or up to three parents) is skipped.
//
// LEVELS below is the one place that sets a rule's level. The rules new to apps start as 'warn', so no app breaks today; to make a rule
// block, change its entry to 'error' (and run the fleet baseline in the pull request that does it).
//
// Rules: raw-element, kit-block, line-length, component-length, file-length | design-card-flat, design-icons-phosphor,
// design-touch-target, design-button-raw-height, design-no-dark-overrides, design-link-token, design-mono-for-code (the Factory
// template's) | design-color, design-border-width, design-font-tokens, design-literal-value, design-dark-variant, design-no-x-scroll (the
// kit's BORING-UI-1 app profile, `check --design`) | design-tokens-only, design-no-kit-restyle, design-no-important,
// design-hand-touch-size (new).
//
// Tokens only: a hex, rgb, hsl or oklch literal and a Tailwind palette colour (`bg-red-500`) are design-color, except in theme.core.css
// and theme.derived.css (and the token blocks of any css). An arbitrary value `utility-[...]` (colour, size, spacing, radius, text) is
// design-tokens-only unless its brackets hold `var(--token)` or its utility is one of STRUCTURAL. Variants (`data-[state=open]:`,
// `[&>svg]:`) are not values and pass.


/**
 * The level of each rule: 'error' fails the run (exit 1), 'warn' is listed. THE one place to set a rule's level.
 * Every rule is an error, frozen by design-master after a false-positive read. An app with existing hits lists them in
 * design.exceptions.json (a list that only shrinks, see applyExceptions); an unlisted hit fails. The only warn left is a finding in an
 * app's own legacy components/ui folder.
 */
export const LEVELS = Object.freeze({
  // The Factory template's rules, at the levels they have there.
  'raw-element': 'error',
  'line-length': 'error',
  'component-length': 'error',
  'file-length': 'error',
  'kit-block': 'error',
  'design-card-flat': 'error',
  'design-icons-phosphor': 'error',
  'design-touch-target': 'error',
  'design-button-raw-height': 'error',
  'design-no-dark-overrides': 'error',
  'design-link-token': 'error',
  'design-mono-for-code': 'error',
  // The kit's app profile and the tokens-only rule, new to apps.
  'design-tokens-only': 'error',
  'design-color': 'error',
  'design-border-width': 'error',
  'design-font-tokens': 'error',
  'design-literal-value': 'error',
  'design-dark-variant': 'error',
  'design-no-x-scroll': 'error',
  // New rules.
  'design-no-kit-restyle': 'error',
  'design-no-important': 'error',
  'design-hand-touch-size': 'error',
  'design-theme-core-only': 'error',
  'design-theme-roles-both-modes': 'error',
  'design-overlay-has-title': 'error',
  'design-theme-local-derived': 'error',
  'design-exceptions-shrink': 'error',
});

/** The utilities whose arbitrary value is structure that composes tokens (tracks, a ratio, a stacking index), not a visual value. */
export const STRUCTURAL = Object.freeze(['grid-cols', 'grid-rows', 'auto-cols', 'auto-rows', 'aspect', 'z', 'order', 'col', 'row', 'columns', 'content', 'will-change']);
/** The kit controls whose height the kit floor sets (--control-h: 44px on touch, 36px on a fine pointer). */
const CONTROLS = /^(?:Button|IconButton|Toggle|ToggleGroupItem|Input|Textarea|SelectTrigger|NativeSelect|Checkbox|Switch|InputGroupInput|InputGroupButton)$/;
/** Files that define the theme: colour literals belong there. */
const THEME_FILES = new Set(['theme.core.css', 'theme.derived.css']);


export const LIMITS = Object.freeze({ line: 200, component: 150, file: 400 });
export const ELEMENT_KIT = Object.freeze({
  table: '@boring/ui/shadcn/table (Table, TableRow, TableCell...)',
  select: '@boring/ui/shadcn/select or native-select',
  input: '@boring/ui/shadcn/input',
  details: '@boring/ui/shadcn/collapsible or accordion',
  summary: '@boring/ui/shadcn/collapsible or accordion (CollapsibleTrigger)',
  label: '@boring/ui/shadcn/label or field',
  textarea: '@boring/ui/shadcn/textarea',
  button: '@boring/ui/shadcn/button',
});
const UI_DIR = 'components/ui';
export const LEGACY_NOTE = 'legacy components/ui path: factory D-1688 (Anciennes apps passent au kit) moves the app onto @boring/ui/shadcn/*';

/** The source with comments and the inside of string literals blanked out (same length, same lines), so a rule never reads them; `strings: false` blanks the comments only. */
export function mask(text, { strings = true } = {}) {
  const out = [...text];
  const blank = (from, to) => { for (let i = from; i < to; i++) if (out[i] !== '\n') out[i] = ' '; };
  const resume = []; // brace depth at which each open `${` hands back to its template literal
  let depth = 0, i = 0;
  const template = (start) => { // the text of a template literal from `start`, to its closing backtick or a `${`
    let j = start;
    while (j < text.length) {
      if (text[j] === '\\') { j += 2; continue; }
      if (text[j] === '`') { if (strings) blank(start, j); return j + 1; }
      if (text[j] === '$' && text[j + 1] === '{') { if (strings) blank(start, j); resume.push(depth++); return j + 2; }
      j++;
    }
    if (strings) blank(start, text.length);
    return text.length;
  };
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (c === '/' && n === '/') { const end = text.indexOf('\n', i); const to = end < 0 ? text.length : end; blank(i, to); i = to; }
    else if (c === '/' && n === '*') { const end = text.indexOf('*/', i + 2); const to = end < 0 ? text.length : end + 2; blank(i, to); i = to; }
    else if (c === '"' || c === "'") { // a string ends at its quote or at the line's end (an apostrophe in JSX text must not swallow the file)
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      if (strings) blank(i + 1, Math.min(j, text.length));
      i = j + 1;
    } else if (c === '`') i = template(i + 1);
    else if (c === '{') { depth++; i++; }
    else if (c === '}') {
      depth--;
      if (resume.length && resume[resume.length - 1] === depth) { resume.pop(); i = template(i + 1); } else i++;
    } else i++;
  }
  return out.join('');
}

const lineAt = (text, index) => { let n = 1; for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++; return n; };

/** The index just after the bracket that closes the one at `open` (in masked text), or -1. */
function closing(code, open) {
  const close = { '{': '}', '(': ')' }[code[open]];
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === code[open]) depth++;
    else if (code[i] === close && --depth === 0) return i + 1;
  }
  return -1;
}

const ALLOWED_INPUT = /\btype\s*=\s*(?:["']|\{\s*["'])(?:file|hidden)\b/;

function rawElements(file, source, tags) {
  return tags.filter(({ name, text }) => Object.hasOwn(ELEMENT_KIT, name) && !(name === 'input' && ALLOWED_INPUT.test(text)))
    .map(({ name, index }) => ({ file, line: lineAt(source, index), rule: 'raw-element', message: `raw <${name}>: use ${ELEMENT_KIT[name]}` }));
}

// The kit's blocks (the UI bundle's @boring/ui/blocks/<block>/...), by the hand-made UI they replace. The table of needs and blocks
// is boring-factory's skills/boring-app-template/references/kit-blocks.md.
/** The registry.json items each hint may name (a test checks they exist). */
export const BLOCK_ITEMS = Object.freeze({ upload: ['file-pick', 'file-tree', 'pi-chat-attachments'], overlay: ['app-shell'], chat: ['pi-chat', 'app-shell'], voice: ['pi-chat-voice', 'app-shell'], camera: ['pi-chat-attachments'] });
export const BLOCKS = Object.freeze({
  upload: 'FilePick for a single pick or drop button (@boring/ui/blocks/file-pick/file-pick: a choose-a-file Button, optional drop strip, accept and size refusals), the file-tree block for a list of files (FileTreeView upload), pi-chat-attachments in the chat',
  overlay: "app-shell's AppSheet (@boring/ui/blocks/app-shell/index)",
  chat: "pi-chat, through the shell's agent layer (AppShell agent={useAgentChat(name)}): it draws the bubbles and the typing state",
  voice: "pi-chat-voice (voice messages in the chat) or app-shell's useDictation (@boring/ui/blocks/app-shell/index)",
  camera: 'pi-chat-attachments (CameraSheet)',
});

const OPEN_TAG = /(?<![\w$.)\]])<([A-Za-z][\w.]*)(?=[\s/>])/g;
const word = (token) => new RegExp(`(?<![\\w:-])${token}(?![\\w-])`);
const FILE_INPUT = /^type\s*=\s*(?:["']file["']|\{\s*["']file["']\s*\})/;
const fileInput = (text) => [...mask(text).matchAll(/(?<![\w$-])type\s*=/g)]
  .some((match) => FILE_INPUT.test(text.slice(match.index)));

const POPUP = word('popup-sheet'), FIXED = word('fixed'), INSET = word('inset-0');
const BUBBLE = word('(?:chat|message|msg)-bubble'), TYPING = word('typing-(?:indicator|dots)');

/** The JSX opening tags of a file: name, start, end (after `>`), whether self-closing, and the tag's source text. */
function openTags(source, code) {
  return [...code.matchAll(OPEN_TAG)].map((match) => {
    let end = match.index + match[0].length, braces = 0;
    for (; end < code.length; end++) {
      if (code[end] === '{') braces++;
      else if (code[end] === '}') braces--;
      else if (code[end] === '>' && braces <= 0 && code[end - 1] !== '=') break;
    }
    const text = mask(source.slice(match.index, end + 1), { strings: false });
    return { name: match[1], index: match.index, end: end + 1, closed: text.endsWith('/>'), text };
  });
}

/** The `{ index, need }` of each hand-made element in the file's JSX tags. */
function tagFindings(tags) {
  const found = [];
  for (const tag of tags) {
    const dom = /^[a-z]/.test(tag.name), own = ownClassName(tag.text, mask(tag.text));
    const cls = classTokens(own).join(' '), at = (need) => found.push({ index: tag.index, need });
    if (tag.name === 'input' && fileInput(tag.text)) at('upload');
    if (dom && (POPUP.test(cls) || (!/[?&|]/.test(own) && FIXED.test(cls) && INSET.test(cls)))) at('overlay');
    if (dom && (BUBBLE.test(cls) || TYPING.test(cls))) at('chat');
  }
  return found;
}

/** The `{ index, need }` of hand-made chat and capture, read from the file's code rather than one tag. */
function codeFindings(code) {
  const found = [];
  for (const m of code.matchAll(/\bnew\s+(?:webkit)?SpeechRecognition\s*\(/g)) found.push({ index: m.index, need: 'voice' });
  for (const m of code.matchAll(/\bgetUserMedia\s*\(/g)) {
    const end = closing(code, m.index + m[0].length - 1), args = code.slice(m.index, end < 0 ? undefined : end);
    if (/\baudio\s*:\s*(?:true\b|\{)/.test(args)) found.push({ index: m.index, need: 'voice' });
    else if (/\bvideo\s*:\s*(?:true\b|\{)/.test(args)) found.push({ index: m.index, need: 'camera' });
  }
  return found;
}

const WHAT = Object.freeze({ upload: 'a hidden file input', overlay: 'a hand-made fixed overlay or .popup-sheet', chat: 'hand-made chat bubbles or typing indicator', voice: 'hand-made microphone capture', camera: 'hand-made camera capture' });

function kitBlocks(file, source, code, tags) {
  const seen = new Set();
  return [...tagFindings(tags), ...codeFindings(code)].flatMap(({ index, need }) => {
    const line = lineAt(source, index), key = `${line} ${need}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ file, line, rule: 'kit-block', message: `${WHAT[need]}: use ${BLOCKS[need]}` }];
  });
}

const JSX_LINE = /<\/?[A-Za-z][\w.]*|\/>|<>|<\/>/;

function longLines(file, source, code) {
  const found = [];
  const lines = source.split('\n'), coded = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > LIMITS.line && JSX_LINE.test(coded[i])) found.push({ file, line: i + 1, rule: 'line-length', message: `JSX line of ${lines[i].length} characters (max ${LIMITS.line}): break it into elements or components` });
  }
  return found;
}

// `function Name` or `const Name = [memo(|forwardRef(] (...) =>` / `function`: a capitalised function is a component.
const DECLARATION = /(?<![\w$.])(?:function\s+([A-Z]\w*)|(?:const|let)\s+([A-Z]\w*)\s*(?::[^=\n]+)?=\s*(?:(?:React\.)?(?:memo|forwardRef)\s*(?:<[^()]*>)?\s*\(\s*)?(?=(?:async\s+)?(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>)))/g;

/** The index of the `{` or `(` that opens the body of the function declared at `from` (just after its name or `=`), or -1. */
function bodyOf(code, from, expression) {
  let i = from;
  const skip = () => { while (/\s/.test(code[i] ?? '')) i++; };
  skip();
  if (expression) {
    const head = /^(?:async\s+)?(?:function\b)?/.exec(code.slice(i))[0];
    i += head.length;
    skip();
    if (/[\w$]/.test(code[i] ?? '') && !head.includes('function')) { while (/[\w$]/.test(code[i] ?? '')) i++; } // `props =>`
  }
  if (code[i] === '<') { const gt = code.indexOf('>', i); if (gt < 0) return -1; i = gt + 1; skip(); } // type parameters
  if (code[i] === '(') { const close = closing(code, i); if (close < 0) return -1; i = close; }
  if (expression && !/^[^=;{]*=>/.test(code.slice(i))) { // a function expression: its body is the next brace
    const brace = code.indexOf('{', i);
    return brace >= 0 && !/;/.test(code.slice(i, brace)) ? brace : -1;
  }
  if (expression) i += /^[^=;{]*=>\s*/.exec(code.slice(i))[0].length;
  else { const brace = code.indexOf('{', i); if (brace < 0 || /;/.test(code.slice(i, brace))) return -1; i = brace; }
  return code[i] === '{' || code[i] === '(' ? i : -1;
}

function components(file, source, code) {
  const found = [], seen = new Set();
  for (const match of code.matchAll(DECLARATION)) {
    const name = match[1] ?? match[2];
    const body = bodyOf(code, match.index + match[0].length, match[2] !== undefined);
    if (body < 0 || seen.has(body)) continue; // `const A = memo(function A() {})` is one component
    seen.add(body);
    const end = closing(code, body);
    if (end < 0) continue;
    const start = lineAt(source, match.index), size = lineAt(source, end - 1) - start + 1;
    if (size > LIMITS.component) found.push({ file, line: start, rule: 'component-length', message: `${name} is ${size} lines (max ${LIMITS.component}): split it into smaller components` });
  }
  return found;
}

const CARD_OPEN = /(?<![\w$.)\]])<(Card(?:Header|Title|Description|Action|Content|Footer)?)(?=[\s/>])|<\/Card>/g;
const CONTROL_TAG = /(?<![\w$.)\]])<(Button|Input|Textarea|SelectTrigger|NativeSelect|Toggle)(?=[\s/>])/g;
const EDGE_CLASS = /^(?:[\w-]+:)*(?:ring|border|shadow)(?:-(?!0$|none$).+)?$/;
// A Button's height is the --control-h token (44px on touch or under md, 36px on a fine pointer, [data-density=compact] 36px). A raw height
// (h-8, size-8, md:h-12, min-h-11, h-[30px]) bypasses it; the size prop (sm, xs, icon-sm, icon-xs) is the route to a smaller one.
// Layout (w-, max-h-, h-auto/full/fit/screen, min-h-0/full) stays allowed (h-0 and size-0 are not), and so does a height that reads the token itself.
const RAW_HEIGHT = /^(?:[\w-]+:)*(?:h-|size-|min-h-(?!0$))(?:\d+(?:\.\d+)?|px|\[(?![^\]]*--control-)[^\]]+\]|\((?!--control-)--[^)]+\))$/;
const SMALL_SIZE = /^(?:[\w-]+:)*(?:h|size)-(?:\d+(?:\.\d+)?|px)$/;
const REACHES_44 = /^(?:[\w-]+:)*(?:min-h-(?:1[1-9]|[2-9]\d|\[(?:4[4-9]|[5-9]\d)px\])|h-(?:1[1-9]|[2-9]\d)|size-(?:1[1-9]|[2-9]\d))$/;

/** The index of the `>` that closes the opening tag starting at `from`. */
function tagEnd(code, from) {
  let braces = 0, end = from;
  for (; end < code.length; end++) {
    if (code[end] === '{') braces++;
    else if (code[end] === '}') braces--;
    else if (code[end] === '>' && braces <= 0 && code[end - 1] !== '=') break;
  }
  return end;
}

/** The class tokens written as string literals in a piece of source. */
const classTokens = (text) => [...text.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)].flatMap((m) => m[2].split(/\s+/)).filter(Boolean);
/** The text of the `className=`/`class=` props of a tag (their string, braces and cn()/clsx() arguments), not other props like id or data-testid. */
function classProps(tag) {
  let out = '';
  for (const m of tag.matchAll(/(?<![\w$-])(?:className|class)\s*=\s*/g)) {
    let i = m.index + m[0].length;
    if (tag[i] === '"' || tag[i] === "'") { const close = tag.indexOf(tag[i], i + 1); out += tag.slice(i, close < 0 ? tag.length : close + 1) + ' '; }
    else if (tag[i] === '{') { const close = closing(maskedBraces(tag), i); out += tag.slice(i, close < 0 ? tag.length : close) + ' '; }
  }
  return out;
}
const maskedBraces = (text) => mask(text);
const hit = (file, source, index, rule, message) => ({ file, line: lineAt(source, index), rule, message });

function cardClasses(file, source, code) {
  const found = [];
  let depth = 0;
  for (const match of code.matchAll(CARD_OPEN)) {
    if (!match[1]) { depth = Math.max(0, depth - 1); continue; }
    const end = tagEnd(code, match.index);
    const bad = classTokens(classProps(source.slice(match.index, end))).filter((t) => EDGE_CLASS.test(t));
    if (bad.length) found.push(hit(file, source, match.index, 'design-card-flat', `<${match[1]}> carries ${bad.join(' ')}: a card is flat, its edge comes from the theme tokens, not classes`));
    if (match[1] !== 'Card') continue;
    if (depth > 0) found.push(hit(file, source, match.index, 'design-card-flat', 'a <Card> inside a <Card>: keep one card level (a plain div or a Separator groups the inside)'));
    if (code[end - 1] !== '/') depth++;
  }
  return found;
}

function iconsPhosphor(file, source, code) {
  const found = [];
  for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])lucide-react(?:\/[^'"]*)?\1/g)) {
    if (code[match.index] === ' ') continue; // inside a comment or a string
    found.push(hit(file, source, match.index, 'design-icons-phosphor', 'lucide-react import: use @phosphor-icons/react'));
  }
  return found;
}

/** The Button's own className value: a className inside another prop (children={<Icon className=.../>}) belongs to that element, not to the Button. */
function ownClassName(tag, masked) {
  const depth = [];
  let d = 0;
  for (let i = 0; i < masked.length; i++) { depth[i] = d; if (masked[i] === '{') d++; else if (masked[i] === '}') d--; }
  let out = '';
  for (const m of tag.matchAll(/(?<![\w$-])(?:className|class)\s*=\s*/g)) {
    if (depth[m.index] !== 0) continue;
    const i = m.index + m[0].length;
    if (tag[i] === '"' || tag[i] === "'") { const close = tag.indexOf(tag[i], i + 1); out += tag.slice(i, close < 0 ? tag.length : close + 1) + ' '; }
    else if (tag[i] === '{') { const close = closing(maskedBraces(tag), i); out += tag.slice(i, close < 0 ? tag.length : close) + ' '; }
  }
  return out;
}

function buttonRawHeight(file, source, code) {
  const found = [];
  for (const match of code.matchAll(/(?<![\w$.)\]])<Button(?=[\s/>])/g)) {
    const end = tagEnd(code, match.index), own = ownClassName(source.slice(match.index, end), code.slice(match.index, end));
    const bad = classTokens(own).filter((t) => RAW_HEIGHT.test(t) && !HAND_TOUCH.test(t)); // 44px by hand is design-hand-touch-size
    if (bad.length) found.push(hit(file, source, match.index, 'design-button-raw-height', `<Button> carries ${bad.join(' ')}: a raw height bypasses --control-h (44px on touch, 36px on a fine pointer); use the size prop (sm, xs, icon-sm, icon-xs) for a smaller one`));
  }
  return found;
}

function touchTarget(file, source, code) {
  const found = [];
  for (const match of code.matchAll(CONTROL_TAG)) {
    const tokens = classTokens(source.slice(match.index, tagEnd(code, match.index)));
    if (match[1] === 'Button') continue; // a Button is judged by buttonRawHeight
    if (tokens.some((t) => SMALL_SIZE.test(t)) && !tokens.some((t) => REACHES_44.test(t))) found.push(hit(file, source, match.index, 'design-touch-target', `<${match[1]}> sized under 44px: drop the small height, the kit floor makes a control 44px on touch (--control-h); use the size prop for a smaller one`));
  }
  return found;
}

// A colour utility, not a size, width, style or position one (`dark:text-sm`, `dark:border-0`, `dark:shadow-none` are not colours).
const NOT_COLOR = '(?:(?:[xytrblse]-)?\\d+(?:\\.\\d+)?(?:%|px)?|(?:[xytrblse]|xs|sm|md|lg|xl|\\dxl|base|none|auto|inner|inset|solid|dashed|dotted|double|hidden|wavy|reverse|collapse|separate|spacing|offset|left|right|center|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|cover|contain|repeat|no-repeat|fixed|local|scroll|top|bottom|origin|gradient|linear|radial|conic|from-font|thin|normal|italic|underline|overline|line-through|uppercase|lowercase|capitalize|truncate)(?![\\w-])|(?:x|y)-\\d+)';
const DARK_COLOR = new RegExp(`(?<![\\w-])dark:(?:[a-z0-9-[\\]]+:)*(?:bg|text|border|ring|fill|stroke|from|via|to|outline|divide|shadow|accent|caret|decoration|placeholder)-(?!${NOT_COLOR})`, 'g');

const LINK_EVENT = /(?<![\w$.)\]])<(\/)?([A-Za-z][\w.]*)(?=[\s/>])/g;
const VOID_TAG = /^(?:img|br|hr|input|meta|link)$/;
// Links that are not inline text and keep their own look: navigation chrome, button-wrapped links, menu/tab items, block cards.
const isChrome = (name) => name === 'nav' || /^(?:Sidebar|NavigationMenu|Breadcrumb|Tabs)/.test(name);
const BLOCK_CLASS = /^(?:[\w-]+:)*(?:block|flex|inline-flex|grid)$/;
const OWN_LOOK = /(?<![\w$-])data-slot\s*=|(?<![\w$-])role\s*=\s*\{?\s*["'](?:tab|menuitem)["']/;
const LINK_PROP = /(?<![\w$-])(?:href|to)\s*=/;
const NOT_LINKS = /^(?:Navigate|Redirect|Route|Routes)$/; // redirects and route tables carry `to`/`href` but are not links
const BUTTON_TAG = /^(?:Button|[A-Z]\w*Button)$/; // a kit Button or a button-variant component
const RENDER_LINK = /(?<![\w$-])render\s*=\s*\{\s*(<(?:a|Link|NavLink)(?=[\s/>]))/; // base-ui: `render` is how a Button becomes a link
const LINK_FIX = 'use text-link underline underline-offset-4 (the --link role)';

function linkToken(file, source, code) {
  const found = [], stack = [], renderLinks = new Map(), events = [...code.matchAll(LINK_EVENT)], bare = mask(source, { strings: false }); // comments are not classes
  const classesOf = (open) => classTokens(classProps(open)).flatMap((t) => t.split(/[\s"'`{}$?()]+/)).filter(Boolean); // a template literal's ${..} parts too
  events.forEach((match, k) => {
    const tag = match[2];
    if (match[1]) { const at = stack.map((s) => s.tag).lastIndexOf(tag); if (at >= 0) stack.length = at; return; }
    const end = tagEnd(code, match.index), open = bare.slice(match.index, end);
    const own = classesOf(open);
    const asChild = /(?<![\w$-])asChild\b/.test(code.slice(match.index, end));
    const render = BUTTON_TAG.test(tag) ? RENDER_LINK.exec(code.slice(match.index, end)) : null;
    if (render) renderLinks.set(match.index + render.index + render[0].lastIndexOf('<'), own); // only the <a> in render= is exempt, not one in another prop
    const wrapped = !!render || renderLinks.has(match.index) || stack.some((s) => isChrome(s.tag) || (s.tag === 'Button' && s.asChild));
    if (code[end - 1] !== '/' && !VOID_TAG.test(tag)) stack.push({ tag, asChild, tokens: own });
    const link = !render && !NOT_LINKS.test(tag) && (tag === 'a' || (/^[A-Z]/.test(tag) && LINK_PROP.test(code.slice(match.index, end))));
    // a Button asChild hands its classes to the link it wraps (shadcn merges them): they count as the link's
    const tokens = link ? [...own, ...stack.filter((s) => s.tag === 'Button' && s.asChild).flatMap((s) => s.tokens), ...(renderLinks.get(match.index) ?? [])] : own;
    const primary = tokens.filter((t) => /^(?:[\w-]+:)*text-primary$/.test(t));
    const underlined = tokens.some((t) => /^(?:[\w-]+:)*underline$/.test(t));
    if (primary.length && (link || underlined)) { found.push(hit(file, source, match.index, 'design-link-token', `<${tag}> uses ${primary.join(' ')} as a link: ${LINK_FIX}`)); return; }
    const next = events[k + 1];
    const ownLook = isChrome(tag) || OWN_LOOK.test(open) || tokens.some((t) => BLOCK_CLASS.test(t)) || (next && !next[1] && /^Card/.test(next[2]));
    if (link && !tokens.includes('text-link') && !ownLook && !wrapped) found.push(hit(file, source, match.index, 'design-link-token', `link <${tag}> without text-link: ${LINK_FIX}`));
  });
  return found;
}

const MONO_CLASS = /(?<![\w$-])(?:[\w-]+:)*(?:font-mono|font-\[family-name:var\(--font-mono\)\])(?![\w-])/;
const MONO_TAG = /^(?:code|kbd|pre|samp)$/;
const CODE_VARIANT = /(?<![\w$-])variant\s*=\s*(?:"code"|'code'|\{\s*["']code["']\s*\})/;
const MONO_FIX = 'use the sans token; add tabular-nums for numbers';

function monoForCode(file, source, code) {
  const found = [], bare = mask(source, { strings: false });
  for (const match of code.matchAll(/(?<![\w$.)\]])<([A-Za-z][\w.]*)(?=[\s/>])/g)) {
    const end = tagEnd(code, match.index), open = bare.slice(match.index, end);
    if (MONO_TAG.test(match[1]) || /(?<![\w$-])data-mono-id\b/.test(open)) continue;
    if (match[1] === 'Textarea' && CODE_VARIANT.test(open)) continue; // D-1782: the kit Textarea variant="code" is the one mono field
    if (classTokens(classProps(open)).flatMap((t) => t.split(/[\s"'`{}$?()]+/)).some((t) => MONO_CLASS.test(t)) || MONO_CLASS.test(classProps(open)))
      found.push(hit(file, source, match.index, 'design-mono-for-code', `<${match[1]}> uses the mono font outside code, kbd, pre, samp or data-mono-id: ${MONO_FIX}`));
  }
  return found;
}


// ---- The kit's rules, new to the app check ------------------------------------------------------------------------------------------

/** The one sentence every kit-part message ends on. */
export const APP_SENTENCE = 'An app writes theme tokens and its own components, and its components are built from kit primitives and blocks; it never copies or restyles a kit part.';

// An arbitrary value after a utility: `w-[340px]`, `md:p-[3px]`, `bg-[var(--x)]`. A variant (`data-[state=open]:`, followed by `:`) is not a value.
const ARBITRARY_VALUE = /(?<![\w-])(?:[\w-]+:)*(-?[a-z][a-z0-9]*(?:-[a-z0-9]+)*)-\[([^\]\s]+)\](?!:)/g;
const COLOR_LITERAL = /^(?:#|(?:rgb|rgba|hsl|hsla|oklch|oklab)\()/; // design-color owns these
const TEST_FILE = /\.(?:test|spec|fixtures?)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|__fixtures__)\//;
const COLOR_PROPERTY = /(?:color|background|fill|stroke|border|shadow|outline|stop-color|stopColor|flood-color|gradient)\w*["']?\s*[:=]\s*(?:\{\s*)?["'`]?[^"'`\n]{0,12}$/i;
const lineStarts = (source) => { const out = [0]; for (let i = 0; i < source.length; i++) if (source[i] === '\n') out.push(i + 1); return out; };
const HAND_TOUCH =/^(?:[\w-]+:)*(?:h|min-h|size|min-w)-11$/; // 44px by hand, with or without a pointer-coarse:/max-md: variant

/** The source ranges that hold Tailwind classes: className=/class= values, the arguments of cn(), cva(), clsx(), cx(), twMerge(), tw() and tw`...`. Prose elsewhere is not classes. */
function classRanges(source) {
  const code = mask(source), ranges = [];
  const add = (from, to) => ranges.push([from, to < 0 ? source.length : to]);
  for (const m of code.matchAll(/(?<![\w$-])(?:className|class)\s*=\s*/g)) {
    const i = m.index + m[0].length;
    if (source[i] === '"' || source[i] === "'") add(i, source.indexOf(source[i], i + 1) + 1 || -1);
    else if (code[i] === '{') add(i, closing(code, i));
  }
  for (const m of code.matchAll(/(?<![\w$.-])(?:cn|cva|clsx|cx|twMerge|tw)\s*\(/g)) add(m.index, closing(code, m.index + m[0].length - 1));
  for (const m of code.matchAll(/(?<![\w$.-])tw\s*`/g)) add(m.index, source.indexOf('`', m.index + m[0].length) + 1 || -1);
  return ranges;
}

function classRules(file, source) {
  const found = [], bare = mask(source, { strings: false }), ranges = classRanges(source);
  const darkLines = new Set();
  for (const m of bare.matchAll(DARK_COLOR)) {
    if (!ranges.some(([from, to]) => m.index >= from && m.index < to)) continue; // a sample string or prose, not a class
    darkLines.add(lineAt(source, m.index)); found.push(hit(file, source, m.index, 'design-no-dark-overrides', 'a dark: colour class: set the dark value on the token in the theme, the tokens switch with .dark')); }
  for (const m of bare.matchAll(ARBITRARY_VALUE)) {
    const [whole, utility, value] = m;
    if (!ranges.some(([from, to]) => m.index >= from && m.index < to)) continue; // prose in a string, not a class
    if (value.includes('var(--') || value.startsWith('--') || COLOR_LITERAL.test(value) || STRUCTURAL.includes(utility)) continue;
    found.push(hit(file, source, m.index, 'design-tokens-only', `arbitrary value ${whole}: use a scale step or a var(--token). ${APP_SENTENCE}`));
  }
  return { found, darkLines };
}

function handTouchSize(file, source, code) {
  const found = [];
  for (const match of code.matchAll(/(?<![\w$.)\]])<([A-Z]\w*)(?=[\s/>])/g)) {
    if (!CONTROLS.test(match[1])) continue;
    const end = tagEnd(code, match.index), own = ownClassName(source.slice(match.index, end), code.slice(match.index, end));
    const bad = classTokens(own).filter((t) => HAND_TOUCH.test(t));
    if (bad.length) found.push(hit(file, source, match.index, 'design-hand-touch-size', `<${match[1]}> carries ${bad.join(' ')}: the kit floor already makes a control 44px on touch (--control-h); remove it. ${APP_SENTENCE}`));
  }
  return found;
}

/** The data-slot values of the kit's own parts (shadcn/ui and registry); an app's own data-slot is its own. A test keeps this list equal to the sources. */
export const KIT_SLOTS = Object.freeze([
  'accordion', 'accordion-content', 'accordion-item', 'accordion-trigger', 'accordion-trigger-icon', 'alert', 'alert-action',
  'alert-description', 'alert-dialog', 'alert-dialog-action', 'alert-dialog-cancel', 'alert-dialog-content',
  'alert-dialog-description', 'alert-dialog-footer', 'alert-dialog-header', 'alert-dialog-media', 'alert-dialog-overlay',
  'alert-dialog-portal', 'alert-dialog-title', 'alert-dialog-trigger', 'alert-title', 'attachment', 'attachment-action',
  'attachment-actions', 'attachment-content', 'attachment-description', 'attachment-group', 'attachment-media',
  'attachment-title', 'avatar', 'avatar-badge', 'avatar-fallback', 'avatar-group', 'avatar-group-count', 'avatar-image',
  'breadcrumb', 'breadcrumb-ellipsis', 'breadcrumb-item', 'breadcrumb-list', 'breadcrumb-page', 'breadcrumb-separator', 'bubble',
  'bubble-group', 'bubble-reactions', 'button', 'button-group', 'button-group-separator', 'card', 'card-action', 'card-content',
  'card-description', 'card-footer', 'card-header', 'card-title', 'checkbox', 'checkbox-indicator', 'collapsible',
  'collapsible-content', 'collapsible-trigger', 'composer-field', 'composer-mention-backdrop', 'composer-mention-query',
  'composer-placeholder', 'composer-recording', 'dialog', 'dialog-close', 'dialog-content', 'dialog-description',
  'dialog-footer', 'dialog-header', 'dialog-overlay', 'dialog-portal', 'dialog-title', 'dialog-trigger', 'drawer',
  'drawer-close', 'drawer-content', 'drawer-description', 'drawer-footer', 'drawer-header', 'drawer-overlay', 'drawer-popup',
  'drawer-portal', 'drawer-swipe-handle', 'drawer-title', 'drawer-trigger', 'drawer-viewport', 'dropdown-menu',
  'dropdown-menu-checkbox-item', 'dropdown-menu-checkbox-item-indicator', 'dropdown-menu-content', 'dropdown-menu-group',
  'dropdown-menu-item', 'dropdown-menu-label', 'dropdown-menu-portal', 'dropdown-menu-radio-group', 'dropdown-menu-radio-item',
  'dropdown-menu-radio-item-indicator', 'dropdown-menu-separator', 'dropdown-menu-shortcut', 'dropdown-menu-sub',
  'dropdown-menu-sub-content', 'dropdown-menu-sub-trigger', 'dropdown-menu-trigger', 'empty', 'empty-content',
  'empty-description', 'empty-header', 'empty-icon', 'empty-title', 'field', 'field-content', 'field-description', 'field-error',
  'field-group', 'field-label', 'field-legend', 'field-separator', 'field-separator-content', 'field-set', 'input',
  'input-group', 'input-group-addon', 'input-group-control', 'item-actions', 'item-content', 'item-description', 'item-footer',
  'item-group', 'item-header', 'item-media', 'item-separator', 'item-title', 'kbd', 'kbd-group', 'label', 'marker-content',
  'marker-icon', 'message', 'message-avatar', 'message-content', 'message-footer', 'message-group', 'message-header',
  'message-images', 'message-scroller', 'message-scroller-button', 'message-scroller-content', 'message-scroller-item',
  'message-scroller-viewport', 'native-select', 'native-select-icon', 'native-select-optgroup', 'native-select-option',
  'native-select-wrapper', 'pagination', 'pagination-content', 'pagination-ellipsis', 'pagination-item', 'pagination-link',
  'popover', 'popover-content', 'popover-description', 'popover-header', 'popover-title', 'popover-trigger', 'progress',
  'progress-indicator', 'progress-label', 'progress-track', 'progress-value', 'question-field', 'radio-group',
  'radio-group-indicator', 'radio-group-item', 'scroll-area', 'scroll-area-scrollbar', 'scroll-area-thumb',
  'scroll-area-viewport', 'select-content', 'select-group', 'select-item', 'select-label', 'select-scroll-down-button',
  'select-scroll-up-button', 'select-separator', 'select-trigger', 'select-value', 'separator', 'sheet', 'sheet-close',
  'sheet-content', 'sheet-description', 'sheet-footer', 'sheet-header', 'sheet-overlay', 'sheet-portal', 'sheet-title',
  'sheet-trigger', 'sidebar', 'sidebar-container', 'sidebar-content', 'sidebar-footer', 'sidebar-gap', 'sidebar-group',
  'sidebar-group-content', 'sidebar-header', 'sidebar-inner', 'sidebar-input', 'sidebar-inset', 'sidebar-menu',
  'sidebar-menu-badge', 'sidebar-menu-item', 'sidebar-menu-skeleton', 'sidebar-menu-sub', 'sidebar-menu-sub-item',
  'sidebar-rail', 'sidebar-separator', 'sidebar-trigger', 'sidebar-wrapper', 'skeleton', 'spinner', 'switch', 'switch-thumb',
  'table', 'table-body', 'table-caption', 'table-cell', 'table-container', 'table-footer', 'table-head', 'table-header',
  'table-row', 'tabs', 'tabs-content', 'tabs-list', 'tabs-trigger', 'textarea', 'toggle', 'toggle-group', 'toggle-group-item',
  'tooltip', 'tooltip-content', 'tooltip-provider', 'tooltip-trigger', 'trace', 'trace-collapsible', 'trace-collapsible-content',
  'trace-collapsible-content-inner', 'trace-collapsible-trigger', 'trace-description', 'trace-icon', 'trace-line', 'trace-title',
]);
const KIT_SLOT_SET = new Set(KIT_SLOTS);
const RESTYLE_SELECTOR = /\[data-slot\s*(?:[~|^$*]?=\s*["']?([\w-]+)["']?)?\s*\]|\[data-boring\b|\.app-shell(?![\w-])|\.pi-chat(?![\w-])/g;
const RESTYLE_VARIANT = /\[&[^\s"'`]*?(?:\[data-slot\s*(?:[~|^$*]?=\s*["']?([\w-]+)["']?)?\s*\]|\[data-boring\b|\.app-shell(?![\w-])|\.pi-chat(?![\w-]))/g;
/** A match reaches the kit unless it names a data-slot value the kit does not use. A bare [data-slot] matches every part. */
const reachesKit = (m) => !m[1] || KIT_SLOT_SET.has(m[1]) || (/[~|^$*]=/.test(m[0]) && KIT_SLOTS.some((slot) => slot.includes(m[1])));

/** css selectors, and Tailwind arbitrary descendant variants, that reach into a kit part. */
function restyle(file, source) {
  const found = [], bare = mask(source, { strings: false });
  if (file.endsWith('.css')) bare.split('\n').forEach((text, i) => {
    const m = [...text.matchAll(RESTYLE_SELECTOR)].find(reachesKit);
    if (m) found.push({ file, line: i + 1, rule: 'design-no-kit-restyle', message: `selector ${m[0]} restyles a kit part from app css: set a theme token instead. ${APP_SENTENCE}` });
  });
  else for (const m of bare.matchAll(RESTYLE_VARIANT)) if (reachesKit(m)) found.push(hit(file, source, m.index, 'design-no-kit-restyle', `variant ${m[0]} restyles a kit part: set a theme token instead. ${APP_SENTENCE}`));
  return found;
}

function important(file, source) {
  return [...mask(source, { strings: false }).matchAll(/!important\b/g)].map((m) => hit(file, source, m.index, 'design-no-important', '!important fights the kit cascade: fix the selector or set a theme token'));
}

/** `font-family` literals and `@font-face`: fonts are theme tokens, defined once in theme.core.css. */
function fontFace(file, source) {
  return [...mask(source, { strings: false }).matchAll(/@font-face\b/g)].map((m) => hit(file, source, m.index, 'design-font-tokens', '@font-face outside theme.core.css: fonts are tokens, declare the family there and use var(--font-sans)'));
}

// scanAppDesign rule (the kit's check --design) -> this check's id and fix.
const PROFILE = Object.freeze({
  color: ['design-color', 'colour literal or palette class: use a token (bg-primary, text-muted-foreground, var(--color-x))'],
  'border-width': ['design-border-width', 'a literal border width: use the `border` utility (the theme sets the width)'],
  font: ['design-font-tokens', 'a font-family literal: fonts are tokens, use var(--font-sans) or the font-sans class'],
  'literal-value': ['design-literal-value', 'a literal radius, shadow, font-size or letter-spacing: use the theme utility (rounded-md, shadow-md, text-sm)'],
  dark: ['design-dark-variant', 'a dark: variant: the tokens switch with .dark, set the dark value in the theme'],
  'design-no-x-scroll': ['design-no-x-scroll', 'a table with a horizontal scroll container: truncate the cells and stack below the container width'],
});

// ---- Theme files and overlays ---------------------------------------------------------------------------------------------------------

/** The core roles: what the Factory template's theme.core.css sets (its :root and .dark colour roles, and the radius, border width, font, text and shadow tokens). */
export const CORE_ROLES = Object.freeze(['background', 'card', 'foreground', 'primary', 'primary-foreground', 'accent', 'muted', 'border', 'ring', 'destructive', 'success', 'warning', 'info', 'chart-series-1', 'chart-series-2', 'chart-series-3', 'chart-series-4', 'chart-series-5', 'radius', 'border-width', 'font-sans', 'font-display', 'font-mono', 'text-body', 'text-title', 'shadow-xs', 'shadow-sm', 'shadow-md', 'shadow-lg']);
/**
 * What the Factory template's theme.derived.css computes (the names the kit derives from the core roles). An app sets the core roles; it
 * does not set these above its EXCEPTIONS block. A name in neither list is the app's own token (--pm-*, --shadow-halo, --text-2xs).
 */
export const KIT_DERIVED = Object.freeze([
  'card-foreground', 'popover', 'popover-foreground', 'secondary', 'secondary-foreground', 'accent-foreground', 'muted-foreground', 'input',
  'primary-active', 'link', 'success-foreground', 'warning-foreground', 'info-foreground', 'destructive-soft', 'destructive-soft-foreground',
  'success-soft', 'success-soft-foreground', 'warning-soft', 'warning-soft-foreground', 'info-soft', 'info-soft-foreground',
  'sidebar', 'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground', 'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'font-heading',
  'radius-sm', 'radius-md', 'radius-lg', 'radius-xl', 'radius-2xl', 'radius-3xl', 'radius-4xl',
]);
/** Roles that are not colours: set once, with no dark value. */
const NON_COLOR_ROLE = /^(?:radius|border-width|font-|text-|shadow-|color-)/;
const COLOR_VALUE = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/;
const EXCEPTIONS_MARK = '=== EXCEPTIONS ===';

/** The custom-property declarations of a css file: `{ name, value, line, selector, offset }` (comments blanked, lines kept). */
function cssDeclarations(text) {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const found = [], stack = [];
  let start = 0;
  const flush = (end) => {
    const m = /^(\s*)--([\w-]+)\s*:\s*([\s\S]*?)\s*$/.exec(bare.slice(start, end));
    if (m) found.push({ name: m[2], value: m[3], line: bare.slice(0, start + m[1].length).split('\n').length, selector: stack.at(-1) ?? '', offset: start });
  };
  for (let i = 0; i < bare.length; i++) {
    if (bare[i] === '{') { stack.push(bare.slice(start, i).trim().replace(/\s+/g, ' ')); start = i + 1; }
    else if (bare[i] === '}') { flush(i); stack.pop(); start = i + 1; }
    else if (bare[i] === ';') { flush(i); start = i + 1; }
  }
  return found;
}

/**
 * design-theme-core-only: theme.core.css does not set a name the kit derives (KIT_DERIVED) above its "=== EXCEPTIONS ===" comment. Core roles and
 * the app's own tokens are fine. A token pinned below the comment needs an entry under `exceptions:` in the app's DESIGN.md (`--name` in
 * backticks); the missing entries are one hit for the block. theme.derived.css is computed from the core roles and never edited by hand; it is edited by hand when a declaration holds a
 * colour literal (hex, rgb, hsl, oklch...) or sets a core role: its values are var() and color-mix() of core roles.
 * design-theme-roles-both-modes: every colour role set in theme.core.css :root is also set in .dark, and the reverse.
 */
function themeRules(file, text, exceptions = new Set()) {
  const found = [], name = basename(file), declarations = cssDeclarations(text);
  if (name === 'theme.core.css') {
    const exceptionsAt = text.indexOf(EXCEPTIONS_MARK);
    const declared = exceptionsAt < 0 ? declarations : declarations.filter((d) => d.offset < exceptionsAt);
    const pinned = exceptionsAt < 0 ? [] : declarations.filter((d) => d.offset > exceptionsAt); // below the marker: derived tokens pinned on purpose
    // A kit-derived name set above the marker is a hit; a core role, and a name the kit does not define (an app token), never are.
    for (const d of declared) {
      if (KIT_DERIVED.includes(d.name)) found.push({ file, line: d.line, rule: 'design-theme-core-only', message: `--${d.name} is derived by the kit (theme.derived.css): set the core roles it is computed from, or pin it below the "${EXCEPTIONS_MARK}" comment with an entry under "exceptions:" in DESIGN.md` });
    }
    // The pinned block is documented in DESIGN.md `exceptions:`; the missing reason is one hit for the block, not one per token.
    const undocumented = [...new Set(pinned.filter((d) => !exceptions.has(d.name)).map((d) => d.name))];
    if (undocumented.length) found.push({ file, line: pinned.find((d) => !exceptions.has(d.name)).line, rule: 'design-theme-core-only', message: `${undocumented.length} token(s) pinned below the "${EXCEPTIONS_MARK}" comment have no entry under "exceptions:" in DESIGN.md (${undocumented.slice(0, 4).map((n) => `--${n}`).join(', ')}${undocumented.length > 4 ? ', ...' : ''}): add one with the reason` });
    const modes = { light: new Map(), dark: new Map() };
    // Kit-defined colour names only (core roles, and the kit-derived names an app pins below the comment). An app's own token (--cta,
    // --highlight, --overlay, --pm-shadow-*) may be mode-independent and is never a hit.
    for (const d of declarations) {
      if (NON_COLOR_ROLE.test(d.name) || !(CORE_ROLES.includes(d.name) || KIT_DERIVED.includes(d.name))) continue;
      const selectors = d.selector.split(',').map((part) => part.trim());
      if (selectors.includes(':root')) modes.light.set(d.name, d.line);
      if (selectors.includes('.dark')) modes.dark.set(d.name, d.line);
    }
    for (const [role, line] of modes.light) if (!modes.dark.has(role)) found.push({ file, line, rule: 'design-theme-roles-both-modes', message: `--${role} is set in :root but not in .dark: set the dark value too` });
    for (const [role, line] of modes.dark) if (!modes.light.has(role)) found.push({ file, line, rule: 'design-theme-roles-both-modes', message: `--${role} is set in .dark but not in :root: set the light value too` });
  }
  // theme.derived.css is not read here: an app that has one gets design-theme-local-derived (one report; deleting the file clears it).
  return found;
}

const OVERLAYS = ['AlertDialog', 'Dialog', 'Sheet', 'Drawer'];
/** A kit overlay content (DialogContent, SheetContent, AlertDialogContent, DrawerContent) with no matching *Title inside it. */
function overlayHasTitle(file, source, code) {
  const found = [];
  for (const prefix of OVERLAYS) {
    for (const match of code.matchAll(new RegExp(String.raw`(?<![\w$.)\]])<${prefix}Content(?=[\s/>])`, 'g'))) {
      const end = tagEnd(code, match.index);
      if (code[end - 1] === '/') continue;
      const close = code.indexOf(`</${prefix}Content>`, end);
      const body = code.slice(end, close < 0 ? undefined : close);
      if (!new RegExp(String.raw`<${prefix}Title(?=[\s/>])`).test(body)) found.push(hit(file, source, match.index, 'design-overlay-has-title', `<${prefix}Content> has no <${prefix}Title> inside: add one (className="sr-only" when the design shows none), it is the overlay's accessible name`));
    }
  }
  return found;
}

const SOURCE = /\.(?:[cm]?[jt]sx?|css)$/;

/**
 * The findings of one file: `file` is its path in the report, `source` its text, `scan` the kit's `scanAppDesign`. `ui`: the file is in the app's own
 * components/ui (legacy): only its findings are warnings, the rest of the app is checked as an error.
 */
export function checkSource(file, source, { ui = false, scan, exceptions } = {}) {
  const name = basename(file), tsx = /\.[jt]sx$/.test(file);
  const inUi = ui; // the app's own <root>/components/ui, decided by the caller from the path under the scanned root
  const found = [];
  const darkLines = new Set();
  if (tsx) {
    const code = mask(source), tags = openTags(source, code);
    const design = [...cardClasses(file, source, code), ...iconsPhosphor(file, source, code), ...touchTarget(file, source, code), ...buttonRawHeight(file, source, code), ...(inUi ? [] : linkToken(file, source, code)), ...(inUi ? [] : monoForCode(file, source, code))];
    const classes = classRules(file, source);
    classes.darkLines.forEach((line) => darkLines.add(line));
    design.push(...classes.found, ...handTouchSize(file, source, code), ...overlayHasTitle(file, source, code));
    found.push(...design.map((f) => (inUi ? { ...f, soft: true } : f)));
    if (!inUi) {
      found.push(...kitBlocks(file, source, code, tags), ...rawElements(file, source, tags), ...longLines(file, source, code), ...components(file, source, code));
      const lines = source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length;
      if (lines > LIMITS.file) found.push({ file, line: 1, rule: 'file-length', message: `${lines} lines (max ${LIMITS.file}): split it into modules` });
    }
  }
  if (THEME_FILES.has(name)) found.push(...themeRules(file, source, exceptions));
  if (SOURCE.test(file) && name !== 'theme.core.css') {
    found.push(...restyle(file, source), ...important(file, source), ...fontFace(file, source));
    const bare = mask(source, { strings: false });
    const script = /\.[cm]?[jt]sx?$/.test(file), ranges = script ? classRanges(source) : [], starts = lineStarts(source);
    for (const f of scan(file, bare)) {
      const profile = PROFILE[f.rule];
      if (!profile) continue; // card rules (ported above), arbitrary values (design-tokens-only)
      if (f.rule === 'color' && TEST_FILE.test(file)) continue; // a test or fixture file holds sample data
      if (f.rule === 'color' && script) {
        // A colour (literal or palette name) in script is a style only in a class, or as the value of a colour property or attribute; a code sample, user text and url(#id) are not.
        const at = starts[f.line - 1] + f.column - 1;
        if (!ranges.some(([from, to]) => at >= from && at < to) && !COLOR_PROPERTY.test(source.slice(Math.max(0, at - 40), at))) continue;
      }
      if (f.rule === 'dark' && script) { // a dark: variant is a style only in a class; a sample string and prose are not
        const at = starts[f.line - 1] + f.column - 1;
        if (!ranges.some(([from, to]) => at >= from && at < to)) continue;
      }
      if (name === 'theme.derived.css' && f.rule !== 'font') continue;
      if (f.rule === 'dark' && darkLines.has(f.line)) continue; // already design-no-dark-overrides
      if (f.rule === 'color' && darkLines.has(f.line) && !/^[#(]|\(/.test(f.value)) continue; // the palette class of that dark: override
      found.push({ file, line: f.line, rule: profile[0], message: `${profile[1]} (${String(f.value).trim().slice(0, 60)})`, soft: inUi });
    }
  }
  return found.map(({ soft, ...f }) => ({ ...f, level: soft ? 'warn' : LEVELS[f.rule] ?? 'error', ...(soft && inUi ? { message: `${f.message} (${LEGACY_NOTE})` } : {}) }))
    .sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

// ---- Files, report and entry ------------------------------------------------------------------------------------------------------

/** The paths (relative to the app root) listed in platform.json `paths`, with that root: platform-owned files are not the app's. */
function platformPaths(dir) {
  for (let root = dir, i = 0; i < 4; i++, root = dirname(root)) {
    try { return { root, owned: JSON.parse(readFileSync(join(root, 'platform.json'), 'utf8')).paths ?? [] }; } catch { /* none here */ }
  }
  return { root: dir, owned: [] };
}

/** The scanned files under `dir` (absolute, sorted): code and css, without node_modules (as the template), declarations, platform-owned paths, broken links and symlinked folders. */
export function designFiles(dir) {
  const { root, owned } = platformPaths(dir);
  const skipped = (path) => { const rel = relative(root, path).split(sep).join('/'); return owned.some((own) => rel === own || rel.startsWith(`${own}/`)); };
  const files = [];
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      if (name === 'node_modules' || skipped(path)) continue;
      let stat;
      try { stat = statSync(path); } catch { continue; } // a dangling or looping link
      if (lstatSync(path).isSymbolicLink() && stat.isDirectory()) continue; // a linked folder can loop
      if (stat.isDirectory()) walk(path);
      else if (SOURCE.test(name) && !name.endsWith('.d.ts')) files.push(path);
    }
  };
  walk(dir);
  return files;
}

/** The `--name` entries (in backticks, or `--name:` keys) of the Exceptions section of the nearest DESIGN.md at or above `dir` (4 levels up). */
export function designExceptions(dir) {
  const names = new Set();
  for (let at = dir, depth = 0; depth < 5; depth++, at = dirname(at)) {
    const path = join(at, 'DESIGN.md');
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    const start = text.search(/^(?:#{1,6}\s*exceptions\b|exceptions:)/im);
    if (start >= 0) {
      const rest = text.slice(start).split('\n').slice(1).join('\n');
      const end = rest.search(/^#{1,6}\s|^---\s*$/m);
      for (const m of (end < 0 ? rest : rest.slice(0, end)).matchAll(/`--([\w-]+)`|^\s*-?\s*--([\w-]+)\s*:/gm)) names.add(m[1] ?? m[2]);
    }
    break;
  }
  return names;
}

/** Every finding under `dir`; paths are relative to `cwd`. `changed`: absolute paths to keep (null: all). */
export function designFindings(dir, { cwd = process.cwd(), changed = null, scan } = {}) {
  const exceptions = designExceptions(dir);
  const files = designFiles(dir).filter((path) => !changed || changed.has(path));
  const found = files.flatMap((path) => checkSource(relative(cwd, path).split(sep).join('/'), readFileSync(path, 'utf8'), { ui: relative(dir, path).split(sep).join('/').startsWith(`${UI_DIR}/`), scan, exceptions }));
  const local = files.find((path) => basename(path) === 'theme.derived.css'); // one hit per app, not per line
  if (local) found.push({ file: relative(cwd, local).split(sep).join('/'), line: 1, rule: 'design-theme-local-derived', level: LEVELS['design-theme-local-derived'], message: 'this app has its own theme.derived.css: delete it and import the kit\'s: app.css, then @hachej/boring-ui-kit/theme.derived.css, then ./theme.core.css' });
  return found;
}

/**
 * The exception list, `{"<rule>": {"<file relative to the scanned dir>": <count>}}`, that only shrinks. A rule's first `count` hits in a file are
 * excepted (`excepted: true`, they do not fail); a hit beyond the count, or in an unlisted file, fails at its level. A count above the real
 * count, or a listed rule or file with no hits, is a `design-exceptions-shrink` error ("N hits left, lower the list to N"). The Factory gate,
 * not the kit, refuses a PR that grows the list. With `changed`, only listed files in that set are checked for shrink.
 */
export function applyExceptions(findings, list, { dir, cwd, listFile, changed = null }) {
  const rel = (file) => relative(dir, resolve(cwd, file)).split(sep).join('/');
  const groups = new Map(), used = new Map();
  for (const [rule, files] of Object.entries(list)) {
    if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error(`${listFile}: "${rule}" must map relative files to counts`);
    for (const [file, count] of Object.entries(files)) {
      if (!Number.isInteger(count) || count < 1) throw new Error(`${listFile}: "${rule}" "${file}" must be a positive integer count`);
      groups.set(`${rule}\0${file}`, count);
      used.set(`${rule}\0${file}`, 0);
    }
  }
  const out = findings.map((finding) => {
    const key = `${finding.rule}\0${rel(finding.file)}`;
    if (!groups.has(key)) return finding;
    const seen = used.get(key) + 1;
    used.set(key, seen);
    return seen <= groups.get(key) ? { ...finding, excepted: true } : finding;
  });
  for (const [key, count] of groups) {
    const [rule, file] = key.split('\0'), real = used.get(key);
    if (real >= count || (changed && !changed.has(resolve(dir, file)))) continue;
    out.push({ file: relative(cwd, listFile).split(sep).join('/'), line: 1, rule: 'design-exceptions-shrink', level: LEVELS['design-exceptions-shrink'], message: `${rule} in ${file}: ${real} hits left, lower the list to ${real}${real ? '' : ' (remove it)'}` });
  }
  return out;
}

/** The list for the current hits: every rule's hit count per file, sorted. What `--baseline` prints. */
export function baselineList(findings, dir, cwd) {
  const list = {};
  for (const finding of findings) {
    const file = relative(dir, resolve(cwd, finding.file)).split(sep).join('/');
    list[finding.rule] ??= {};
    list[finding.rule][file] = (list[finding.rule][file] ?? 0) + 1;
  }
  return Object.fromEntries(Object.keys(list).sort().map((rule) => [rule, Object.fromEntries(Object.keys(list[rule]).sort().map((file) => [file, list[rule][file]]))]));
}

export const formatFinding = ({ file, line, rule, message, level, excepted }) => `${excepted ? 'excepted ' : level === 'warn' ? 'warning ' : ''}${file}:${line} ${rule} ${message}`;

export const DESIGN_USAGE = 'usage: boring-ui-blocks design <dir> [--changed <file>...] [--json] [--exceptions <file>] [--baseline]';
const EXCEPTIONS_FILE = 'design.exceptions.json';

/** `boring-ui-blocks design`: exit 0 when no finding is an error, 1 when one is, 2 on bad arguments. `scan` is the kit's scanAppDesign. */
export function designMain(args, cwd, log, error, scan = scanAppDesign) {
  let dir, changed = null, json = false, listFile = null, baseline = false;
  try {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--json') json = true;
      else if (args[i] === '--baseline') baseline = true;
      else if (args[i] === '--exceptions') {
        if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--exceptions needs a file');
        listFile = resolve(cwd, args[++i]);
        if (!existsSync(listFile)) throw new Error(`no such exceptions file: ${listFile}`);
      } else if (args[i] === '--changed') {
        changed ??= new Set();
        while (args[i + 1] && !args[i + 1].startsWith('--')) changed.add(resolve(cwd, args[++i]));
      } else if (args[i].startsWith('--')) throw new Error(`unknown argument ${args[i]}`);
      else if (dir === undefined) dir = resolve(cwd, args[i]);
      else throw new Error(`unexpected argument ${args[i]}`);
    }
    if (dir === undefined) throw new Error('design needs a directory (the app\'s web/src)');
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`no such directory: ${dir}`);
  } catch (cause) {
    error(`error: ${cause.message}\n${DESIGN_USAGE}`);
    return 2;
  }
  let findings;
  try {
    findings = designFindings(dir, { cwd, changed, scan });
    if (baseline) { log(JSON.stringify(baselineList(findings, dir, cwd), null, 2)); return 0; } // prints, writes nothing
    listFile ??= existsSync(join(dir, EXCEPTIONS_FILE)) ? join(dir, EXCEPTIONS_FILE) : null;
    if (listFile) findings = applyExceptions(findings, JSON.parse(readFileSync(listFile, 'utf8')), { dir, cwd, listFile, changed });
  } catch (cause) {
    if (json) log(JSON.stringify({ error: cause.message }));
    else error(`error: ${cause.message}`);
    return 1;
  }
  const live = findings.filter((f) => !f.excepted), excepted = findings.length - live.length;
  const errors = live.filter((f) => f.level === 'error').length, warnings = live.length - errors;
  const counts = {};
  for (const f of live) counts[f.rule] = (counts[f.rule] ?? 0) + 1;
  if (json) log(JSON.stringify({ ok: !errors, errors, warnings, excepted, counts, findings }, null, 2));
  else {
    for (const finding of findings) log(formatFinding(finding));
    log(findings.length ? `design: ${errors} error(s), ${warnings} warning(s)${excepted ? `, ${excepted} excepted` : ''}` : 'design: clean');
  }
  return errors ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
