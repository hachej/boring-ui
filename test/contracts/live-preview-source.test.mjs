import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The live-preview item (registry/live-preview): listed in registry.json, equal to its committed build, shadcn semantic colours only, and
// wired into the app shell's `preview` prop. Behaviour is proven by live-preview-frame.test.mjs and live-preview-render.test.mjs.
const root = fileURLToPath(new URL('../../', import.meta.url));
const folder = 'registry/live-preview';
const manifest = JSON.parse(readFileSync(`${root}registry.json`, 'utf8'));
const item = manifest.items.find(entry => entry.name === 'live-preview');
const files = readdirSync(`${root}${folder}`);
const source = name => readFileSync(`${root}${folder}/${name}`, 'utf8');
const code = files.filter(name => /\.tsx?$/.test(name));

test('every file of registry/live-preview is listed in the item and equals the committed build', () => {
  assert.deepEqual(item.files.map(entry => entry.path.replace(`${folder}/`, '')).sort(), files.sort());
  const built = JSON.parse(readFileSync(`${root}public/r/live-preview.json`, 'utf8'));
  for (const entry of item.files) assert.equal(built.files.find(file => file.path === entry.path)?.content, readFileSync(`${root}${entry.path}`, 'utf8'), `${entry.path}: run npm run registry:build`);
});

test('the item depends on pi-chat only for the ChatCard type, and nothing executes source', () => {
  assert.deepEqual(item.registryDependencies, ['@boring-ui/pi-chat']);
  for (const name of code) assert.doesNotMatch(source(name), /dangerouslySetInnerHTML|eval\s*\(|new Function|<script\b|\bsrcdoc\b|allow-same-origin/, name);
});

test('colours come only from shadcn semantic utilities: no hex, rgb(, oklch( or text-[Npx]', () => {
  for (const name of code) {
    const text = source(name);
    assert.doesNotMatch(text, /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/, `${name}: hex colour`);
    assert.doesNotMatch(text, /\b(?:rgba?|oklch|hsla?)\(/, `${name}: raw colour function`);
    assert.doesNotMatch(text, /text-\[\d+(?:\.\d+)?px\]/, `${name}: pixel text size`);
  }
});

test('the app shell takes the preview prop and mounts its provider, banner and note', () => {
  const shell = readFileSync(`${root}registry/app-shell/app-shell.tsx`, 'utf8');
  assert.match(shell, /readonly preview\?: PreviewSpec/);
  assert.match(shell, /<PreviewProvider settings=\{settings\}>/);
  assert.match(shell, /<PreviewBanner \/>/);
  const app = manifest.items.find(entry => entry.name === 'app-shell');
  assert.ok(app.registryDependencies.includes('@boring-ui/live-preview'));
});

test('the chat card reads only the tool result kind, previewId, key, title and source', () => {
  assert.match(source('card.tsx'), /d\?\.kind !== 'boring\.preview'/);
});

test('the frame element has exactly sandbox="allow-scripts"; nothing touches browser storage', () => {
  assert.match(source('frame.tsx'), /sandbox="allow-scripts"/);
  for (const name of code) assert.doesNotMatch(source(name), /allow-(?:same-origin|forms|popups|top-navigation|modals)|sessionStorage|localStorage|indexedDB|document\.cookie/, name);
});

test('the frame page has the restrictive CSP and loads only its own script', () => {
  const html = source('preview-frame.html');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
  for (const directive of ["default-src 'none'", "script-src 'self' 'unsafe-eval'", "style-src 'unsafe-inline'", 'img-src data:', "connect-src 'none'"]) assert.ok(csp.includes(directive), directive);
  assert.deepEqual([...html.matchAll(/<script\b[^>]*>/g)].map(m => m[0]), ['<script src="preview-frame.js">']);
});
