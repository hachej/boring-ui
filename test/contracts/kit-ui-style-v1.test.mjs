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

const files = directory => readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(`${directory}/${entry.name}`) : /\.tsx?$/.test(entry.name) ? [`${directory}/${entry.name}`] : []);

test('kit ui files take icons from the Phosphor symbol map, not lucide-react', () => {
  const offending = uiDirs.flatMap(files).filter(path => /from\s+['"]lucide-react['"]/.test(readFileSync(join(root, path), 'utf8')));
  assert.deepEqual(offending, [], `lucide-react imported in: ${offending.join(', ')}`);
});
