import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const uiDirs = ['shadcn/ui', 'examples/app-shell/components/ui'];
const cards = ['shadcn/ui/card.tsx', 'examples/app-shell/components/ui/card.tsx'];

// Drops variant prefixes (`dark:`, `has-[>img:first-child]:`) and keeps the utility itself.
function utility(token) {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === ':' && depth === 0) cut = i;
  }
  return token.slice(cut + 1).replace(/^!/, '');
}

function cardRootClasses(path) {
  const source = readFileSync(join(root, path), 'utf8');
  const match = source.match(/data-slot="card"[\s\S]*?className=\{cn\(\s*"([^"]*)"/);
  assert.ok(match, `${path}: no className string on the data-slot="card" element`);
  return match[1].split(/\s+/).filter(Boolean);
}

test('the Card surface is flat: no shadow, ring or border utility', () => {
  for (const path of cards) {
    const offending = cardRootClasses(path).filter(token => /^(shadow|ring|border)(-|$)/.test(utility(token)));
    assert.deepEqual(offending, [], `${path}: Card root has ${offending.join(' ')}`);
  }
});

function alertVariantClasses(variant) {
  const source = readFileSync(join(root, 'shadcn/ui/alert.tsx'), 'utf8');
  const variants = source.match(/variants:\s*\{\s*variant:\s*\{([\s\S]*?)\n      \},/);
  assert.ok(variants, 'shadcn/ui/alert.tsx: no cva variant block');
  const entry = variants[1].match(new RegExp(`\\b${variant}:\\s*"([^"]*)"`));
  assert.ok(entry, `shadcn/ui/alert.tsx: no "${variant}" variant string`);
  return entry[1].split(/\s+/).filter(Boolean);
}

test('Alert default and destructive variants have a contour', () => {
  const expected = {
    default: ['border', 'border-border'],
    destructive: ['border', 'border-destructive', 'bg-destructive-soft'],
  };
  for (const [variant, utilities] of Object.entries(expected)) {
    const classes = alertVariantClasses(variant);
    const missing = utilities.filter(name => !classes.includes(name));
    assert.deepEqual(missing, [], `Alert ${variant} is missing ${missing.join(' ')}`);
  }
});

const files = directory => readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(`${directory}/${entry.name}`) : /\.tsx?$/.test(entry.name) ? [`${directory}/${entry.name}`] : []);

test('kit ui files take icons from the Phosphor symbol map, not lucide-react', () => {
  const offending = uiDirs.flatMap(files).filter(path => /from\s+['"]lucide-react['"]/.test(readFileSync(join(root, path), 'utf8')));
  assert.deepEqual(offending, [], `lucide-react imported in: ${offending.join(', ')}`);
});
