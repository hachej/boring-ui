#!/usr/bin/env node
/**
 * Design Token Linter
 *
 * Enforces that CSS and JS/JSX files use design tokens (CSS custom properties)
 * instead of raw color values. Token definitions live in src/front/styles/tokens.css.
 *
 * Usage:
 *   node scripts/lint-design-tokens.mjs              # lint all frontend files
 *   node scripts/lint-design-tokens.mjs --staged      # lint git-staged files only
 *   node scripts/lint-design-tokens.mjs src/front/foo  # lint specific files
 */

import { readFileSync } from 'fs';
import { resolve, relative, extname } from 'path';
import { execSync } from 'child_process';

const ROOT = resolve(new URL('.', import.meta.url).pathname, '..');
const TOKENS_FILE = resolve(ROOT, 'src/front/styles/tokens.css');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Files/directories that may contain raw color values (token definitions, vendor CSS)
const ALLOWLIST = [
  'src/front/styles/tokens.css',                 // Token definitions
  'src/front/providers/companion/upstream.css',   // Upstream vendor CSS
  'src/front/providers/companion/upstream/',       // Upstream vendor dir
];

// File extensions to lint
const CSS_EXTS = new Set(['.css']);
const JS_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs']);

// Patterns that match raw color literals
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const RGB_RE = /\brgba?\(\s*\d/g;
const HSL_RE = /\bhsla?\(\s*\d/g;

// ---------------------------------------------------------------------------
// Token map: hex value -> token name (for fix suggestions)
// ---------------------------------------------------------------------------

function buildTokenMap() {
  const map = new Map();
  const css = readFileSync(TOKENS_FILE, 'utf8');
  const re = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\b/g;
  let m;
  while ((m = re.exec(css))) {
    const token = `var(--${m[1]})`;
    const hex = m[2].toLowerCase();
    if (!map.has(hex)) map.set(hex, token);
  }
  return map;
}

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

function isAllowlisted(absPath) {
  const rel = relative(ROOT, absPath);
  return ALLOWLIST.some(a => rel === a || rel.startsWith(a));
}

function getStagedFiles() {
  const out = execSync('git diff --cached --name-only --diff-filter=ACMR', {
    cwd: ROOT, encoding: 'utf8',
  });
  return out.trim().split('\n').filter(Boolean).map(f => resolve(ROOT, f));
}

function getAllFrontendFiles() {
  const out = execSync(
    'find src/front -type f \\( -name "*.css" -o -name "*.js" -o -name "*.jsx" -o -name "*.ts" -o -name "*.tsx" -o -name "*.mjs" \\) | sort',
    { cwd: ROOT, encoding: 'utf8' },
  );
  return out.trim().split('\n').filter(Boolean).map(f => resolve(ROOT, f));
}

// ---------------------------------------------------------------------------
// Linting logic
// ---------------------------------------------------------------------------

function lintCSS(filePath, content, tokenMap) {
  const violations = [];
  const lines = content.split('\n');

  // Track whether we're inside a :root or [data-theme] block (token definitions)
  // These are only in styles.css which is allowlisted, but handle defensively
  let inTokenBlock = false;
  let braceDepth = 0;
  let tokenBlockDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//')) continue;

    // Track :root and [data-theme] blocks
    if (/^:root\s*\{|^\[data-theme/.test(trimmed)) {
      inTokenBlock = true;
      tokenBlockDepth = braceDepth;
    }

    // Count braces
    for (const ch of line) {
      if (ch === '{') braceDepth++;
      if (ch === '}') {
        braceDepth--;
        if (inTokenBlock && braceDepth <= tokenBlockDepth) {
          inTokenBlock = false;
        }
      }
    }

    if (inTokenBlock) continue;

    // Skip lines that define CSS custom properties (--var-name: value)
    if (/^\s*--[\w-]+\s*:/.test(line)) continue;

    // Check for raw hex colors NOT inside var() or as part of a custom property value
    // Allow hex inside var() fallbacks: var(--token, #fallback)
    const lineWithoutVars = line.replace(/var\([^)]*\)/g, '');

    let match;
    HEX_RE.lastIndex = 0;
    while ((match = HEX_RE.exec(lineWithoutVars))) {
      const hex = match[0].toLowerCase();
      const suggestion = tokenMap.get(hex);
      const msg = suggestion
        ? `Raw color ${match[0]} — use ${suggestion} instead`
        : `Raw color ${match[0]} — add a token to styles/tokens.css or use an existing one`;
      violations.push({ line: i + 1, col: match.index + 1, msg });
    }

    // Check rgb/rgba/hsl/hsla outside of var()
    RGB_RE.lastIndex = 0;
    while ((match = RGB_RE.exec(lineWithoutVars))) {
      violations.push({
        line: i + 1, col: match.index + 1,
        msg: `Raw color rgb/rgba() — use a design token instead`,
      });
    }
    HSL_RE.lastIndex = 0;
    while ((match = HSL_RE.exec(lineWithoutVars))) {
      violations.push({
        line: i + 1, col: match.index + 1,
        msg: `Raw color hsl/hsla() — use a design token instead`,
      });
    }
  }

  return violations;
}

function lintJS(filePath, content, tokenMap) {
  const violations = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip full-line comments
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    // Strip inline comments to avoid false positives on commented-out code
    const codePart = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');

    // Look for hex color string literals: '#xxx' or "#xxx"
    const hexStringRe = /(['"`])#([0-9a-fA-F]{3,8})\b\1/g;
    let match;
    while ((match = hexStringRe.exec(codePart))) {
      const hex = `#${match[2].toLowerCase()}`;
      const suggestion = tokenMap.get(hex);
      const msg = suggestion
        ? `Raw color '${hex}' — use CSS variable ${suggestion} instead`
        : `Raw color '${hex}' — define a token in styles/tokens.css`;
      violations.push({ line: i + 1, col: match.index + 1, msg });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Cross-validation: backend files that embed inline CSS tokens
// Catches drift between server-rendered HTML templates and tokens.css
// ---------------------------------------------------------------------------

// Backend files known to embed CSS custom properties (add paths here)
const CROSS_CHECK_FILES = [
  'src/back/boring_ui/api/modules/control_plane/auth_router_supabase.py',
];

function buildCanonicalTokens() {
  const css = readFileSync(TOKENS_FILE, 'utf8');
  // Parse both :root (light) and [data-theme="dark"] blocks
  const tokens = { light: new Map(), dark: new Map() };
  let mode = null;
  for (const line of css.split('\n')) {
    if (/^:root\s*\{/.test(line.trim())) mode = 'light';
    else if (/^\[data-theme="dark"\]/.test(line.trim())) mode = 'dark';
    else if (line.trim() === '}') { if (mode) mode = null; }
    if (!mode) continue;
    const m = line.match(/^\s*--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\b/);
    if (m) tokens[mode].set(`--${m[1]}`, m[2].toLowerCase());
  }
  return tokens;
}

function crossCheckFile(filePath, canonical) {
  const violations = [];
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return violations;
  }

  const lines = content.split('\n');
  // Heuristic: detect light vs dark context by tracking @media (prefers-color-scheme: dark)
  let inDarkBlock = false;
  let braceDepth = 0;
  let darkBlockDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/prefers-color-scheme:\s*dark/.test(line)) {
      inDarkBlock = true;
      darkBlockDepth = braceDepth;
    }
    for (const ch of line) {
      if (ch === '{') braceDepth++;
      if (ch === '}') {
        braceDepth--;
        if (inDarkBlock && braceDepth <= darkBlockDepth) inDarkBlock = false;
      }
    }

    const m = line.match(/^\s*--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\b/);
    if (!m) continue;

    const tokenName = `--${m[1]}`;
    const value = m[2].toLowerCase();
    const mode = inDarkBlock ? 'dark' : 'light';
    const canonicalValue = canonical[mode].get(tokenName);

    if (canonicalValue && canonicalValue !== value) {
      violations.push({
        line: i + 1, col: 1,
        msg: `Token drift: ${tokenName} is ${value} here but ${canonicalValue} in styles/tokens.css (${mode} mode)`,
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const staged = args.includes('--staged');
const quiet = args.includes('--quiet');
const fileArgs = args.filter(a => !a.startsWith('--'));

const tokenMap = buildTokenMap();

let files;
if (staged) {
  files = getStagedFiles();
} else if (fileArgs.length > 0) {
  files = fileArgs.map(f => resolve(f));
} else {
  files = getAllFrontendFiles();
}

// Filter to lintable extensions and non-allowlisted files
files = files.filter(f => {
  const ext = extname(f);
  if (!CSS_EXTS.has(ext) && !JS_EXTS.has(ext)) return false;
  if (isAllowlisted(f)) return false;
  return true;
});

let totalViolations = 0;
const results = [];

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue; // File might have been deleted in staging
  }

  const ext = extname(file);
  const violations = CSS_EXTS.has(ext)
    ? lintCSS(file, content, tokenMap)
    : lintJS(file, content, tokenMap);

  if (violations.length > 0) {
    const rel = relative(ROOT, file);
    results.push({ file: rel, violations });
    totalViolations += violations.length;
  }
}

// Cross-check backend files with embedded tokens
const canonical = buildCanonicalTokens();
const crossCheckTargets = staged
  ? getStagedFiles().filter(f => CROSS_CHECK_FILES.includes(relative(ROOT, f)))
  : CROSS_CHECK_FILES.map(f => resolve(ROOT, f));

for (const file of crossCheckTargets) {
  const violations = crossCheckFile(file, canonical);
  if (violations.length > 0) {
    const rel = relative(ROOT, file);
    results.push({ file: rel, violations });
    totalViolations += violations.length;
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (totalViolations === 0) {
  if (!quiet) console.log('\x1b[32m✓ No design token violations found\x1b[0m');
  process.exit(0);
}

console.log(`\x1b[31m✗ Found ${totalViolations} design token violation${totalViolations > 1 ? 's' : ''}:\x1b[0m\n`);

for (const { file, violations } of results) {
  console.log(`  \x1b[36m${file}\x1b[0m`);
  for (const v of violations) {
    console.log(`    \x1b[33m${v.line}:${v.col}\x1b[0m  ${v.msg}`);
  }
  console.log();
}

console.log('\x1b[2mFix: use var(--token-name) from src/front/styles/tokens.css, or add a new token.\x1b[0m');
console.log('\x1b[2mBypass: add the file to ALLOWLIST in scripts/lint-design-tokens.mjs\x1b[0m');

process.exit(1);
