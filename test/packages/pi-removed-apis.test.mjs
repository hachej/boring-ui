import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));

function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'dist' ? [] : sources(path);
    return /\.(ts|tsx|mjs)$/.test(entry.name) ? [path] : [];
  });
}

const removed = [
  ['TypeBox `Type` from pi-ai (tool parameters are plain JSON Schema)', /import\s*\{[^}]*\bType\b[^}]*\}\s*from\s*'@earendil-works\/pi-ai'/],
];

test('no package source uses an API that pi-durable 1.5 removed', () => {
  const packages = readdirSync(join(root, 'packages'));
  const hits = [];
  for (const name of packages) for (const file of sources(join(root, 'packages', name, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const [label, pattern] of removed) if (pattern.test(text)) hits.push(`${file.slice(root.length + 1)}: ${label}`);
  }
  assert.deepEqual(hits, []);
});
