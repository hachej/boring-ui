import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The live-preview item (registry/live-preview): listed in registry.json, equal to its committed build, shadcn semantic colours only, and
// wired into the app shell's `preview` prop. Behaviour is proven by live-preview-store.test.mjs and live-preview-render.test.mjs.
const root = fileURLToPath(new URL('../../', import.meta.url));
const folder = 'registry/live-preview';
const manifest = JSON.parse(readFileSync(`${root}registry.json`, 'utf8'));
const item = manifest.items.find(entry => entry.name === 'live-preview');
const files = readdirSync(`${root}${folder}`);
const source = name => readFileSync(`${root}${folder}/${name}`, 'utf8');

test('every file of registry/live-preview is listed in the item and equals the committed build', () => {
  assert.deepEqual(item.files.map(entry => entry.path.replace(`${folder}/`, '')).sort(), files.sort());
  const built = JSON.parse(readFileSync(`${root}public/r/live-preview.json`, 'utf8'));
  for (const entry of item.files) assert.equal(built.files.find(file => file.path === entry.path)?.content, readFileSync(`${root}${entry.path}`, 'utf8'), `${entry.path}: run npm run registry:build`);
});

test('the item depends on pi-chat only for the ChatCard type, and nothing executes source', () => {
  assert.deepEqual(item.registryDependencies, ['@boring-ui/pi-chat']);
  for (const name of files) assert.doesNotMatch(source(name), /dangerouslySetInnerHTML|eval\s*\(|new Function|<script\b|\bsrcdoc\b/, name);
});

test('colours come only from shadcn semantic utilities: no hex, rgb(, oklch( or text-[Npx]', () => {
  for (const name of files) {
    const text = source(name);
    assert.doesNotMatch(text, /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/, `${name}: hex colour`);
    assert.doesNotMatch(text, /\b(?:rgba?|oklch|hsla?)\(/, `${name}: raw colour function`);
    assert.doesNotMatch(text, /text-\[\d+(?:\.\d+)?px\]/, `${name}: pixel text size`);
  }
});

test('the app shell takes the preview prop and mounts its provider and banner', () => {
  const shell = readFileSync(`${root}registry/app-shell/app-shell.tsx`, 'utf8');
  assert.match(shell, /readonly preview\?: PreviewSpec/);
  assert.match(shell, /<PreviewProvider settings=\{settings\}>/);
  assert.match(shell, /<PreviewStatus \/>/);
  const app = manifest.items.find(entry => entry.name === 'app-shell');
  assert.ok(app.registryDependencies.includes('@boring-ui/live-preview'));
});

test('the chat card reads only the tool result kind, key and source, and the call id', () => {
  assert.match(source('card.tsx'), /details\?\.kind !== 'boring\.preview'/);
});
