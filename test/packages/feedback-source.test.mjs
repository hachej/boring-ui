import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { FEEDBACK_SOURCE_RUNTIME, feedbackSourcePlugin } from '@hachej/boring-feedback/source';
import { Fragment, jsxDEV } from '@hachej/boring-feedback/source/jsx-dev-runtime';

// WP8: esbuild + the feedback JSX dev runtime stamp intrinsic elements with project-relative `data-source`.
const root = fileURLToPath(new URL('../fixtures/feedback-source', import.meta.url));
const fixture = name => readFileSync(join(root, 'src', name), 'utf8').split('\n');
const lineOf = (name, needle) => {
  const index = fixture(name).findIndex(line => line.includes(needle));
  assert.ok(index >= 0, `${needle} in ${name}`);
  return index + 1;
};

const options = (plugins, overrides = {}) => ({
  absWorkingDir: root,
  bundle: true,
  jsx: 'automatic',
  jsxDev: true,
  tsconfigRaw: {},
  logLevel: 'silent',
  plugins,
  ...overrides,
});

/** Bundle the fixture App with React and react-dom/server into one CommonJS module, then server-render it. */
async function renderFixture(t, mode = 'development') {
  const dir = mkdtempSync(join(tmpdir(), 'boring-feedback-source-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const outfile = join(dir, 'render.cjs');
  await build(options([feedbackSourcePlugin({ root, mode })], {
    stdin: {
      contents: "import { createElement } from 'react'; import { renderToString } from 'react-dom/server'; import { App } from './src/App'; export const html = renderToString(createElement(App));",
      resolveDir: root,
      sourcefile: 'render.js',
      loader: 'js',
    },
    outfile,
    format: 'cjs',
    platform: 'node',
    define: { 'process.env.NODE_ENV': '"development"' },
  }));
  return createRequire(import.meta.url)(outfile).html;
}

const elements = html => [...html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/g)].map(([, tag, attributes]) => ({ tag, source: /\bdata-source="([^"]*)"/.exec(attributes)?.[1] }));

test('every host element carries its project-relative file and line; components forward through their root element', async t => {
  const html = await renderFixture(t);
  const found = elements(html);
  const app = needle => `src/App.tsx:${lineOf('App.tsx', needle)}`;
  const bar = needle => `src/SaveBar.tsx:${lineOf('SaveBar.tsx', needle)}`;
  assert.deepEqual(found, [
    { tag: 'main', source: app('<main') },
    { tag: 'h1', source: app('<h1>') },
    { tag: 'ul', source: app('<ul>') },
    { tag: 'li', source: app('<li key') },
    { tag: 'li', source: app('<li key') },
    { tag: 'li', source: app('<li key') },
    { tag: 'p', source: 'explicit/Note.tsx:7' },
    { tag: 'div', source: bar('<div') },
    { tag: 'button', source: bar('<button') },
  ]);
  // The SaveBar component itself names no location: only its host elements do, and no path is absolute.
  assert.equal(html.includes('src/App.tsx:' + lineOf('App.tsx', '<SaveBar')), false);
  assert.equal(html.includes(root), false);
  assert.match(html, /<li data-source="src\/App\.tsx:\d+">Field notes<\/li>/);
});

test('the runtime refuses absolute, drive-letter, scheme and parent paths and never mutates props', () => {
  const stamp = (fileName, props = { className: 'x' }) => jsxDEV('div', props, undefined, false, { fileName, lineNumber: 3, columnNumber: 1 }, undefined).props['data-source'];
  for (const refused of ['/home/someone/app/src/A.tsx', 'C:\\work\\app\\src\\A.tsx', 'C:/work/A.tsx', 'file:///work/A.tsx', '../outside/A.tsx', 'src/../../A.tsx', 'src\\..\\A.tsx', '']) {
    assert.equal(stamp(refused), undefined, refused);
  }
  assert.equal(stamp('src/A.tsx'), 'src/A.tsx:3');
  assert.equal(stamp('src\\Win.tsx'), 'src/Win.tsx:3');
  assert.equal(jsxDEV('div', {}, undefined, false, { fileName: 'src/A.tsx', lineNumber: 0 }, undefined).props['data-source'], undefined);
  assert.equal(jsxDEV('div', {}, undefined, false, undefined, undefined).props['data-source'], undefined);

  const props = Object.freeze({ className: 'kept' });
  const element = jsxDEV('section', props, undefined, false, { fileName: 'src/A.tsx', lineNumber: 9 }, undefined);
  assert.equal(element.props['data-source'], 'src/A.tsx:9');
  assert.deepEqual(props, { className: 'kept' });
  assert.equal(stamp('src/A.tsx', { 'data-source': 'mine.tsx:1' }), 'mine.tsx:1');

  const Component = () => null;
  assert.equal(jsxDEV(Component, {}, undefined, false, { fileName: 'src/A.tsx', lineNumber: 4 }, undefined).props['data-source'], undefined);
  assert.equal(jsxDEV(Fragment, { children: [] }, undefined, true, { fileName: 'src/A.tsx', lineNumber: 4 }, undefined).props['data-source'], undefined);
});

test('production mode and misconfigured builds are refused', async () => {
  assert.throws(() => feedbackSourcePlugin({ root, mode: 'production' }), /refusing a production build/);
  assert.throws(() => feedbackSourcePlugin({ root, mode: 'staging' }), /unknown mode/);
  assert.throws(() => feedbackSourcePlugin({ root: 'relative/app', mode: 'development' }), /absolute/);
  const entryPoints = ['src/App.tsx'];
  const plugin = () => [feedbackSourcePlugin({ root, mode: 'preview' })];
  await assert.rejects(build(options(plugin(), { entryPoints, write: false, jsxDev: false })), /jsxDev: true/);
  await assert.rejects(build(options(plugin(), { entryPoints, write: false, absWorkingDir: join(root, 'src') })), /absWorkingDir/);
  await assert.rejects(build(options(plugin(), { entryPoints, write: false, bundle: false })), /bundle: true/);
});

test('preview builds redirect app JSX to the feedback runtime, which alone imports React\'s runtime', async () => {
  const result = await build(options([feedbackSourcePlugin({ root, mode: 'preview' })], {
    entryPoints: ['src/App.tsx'], write: false, format: 'esm', platform: 'browser', external: ['react', 'react/*'], metafile: true,
  }));
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.some(path => path.endsWith('packages/feedback/dist/source/jsx-dev-runtime.js')), inputs.join(', '));
  const imports = Object.values(result.metafile.inputs).flatMap(input => input.imports.map(i => i.path));
  assert.deepEqual([...new Set(imports.filter(path => path.startsWith('react')))], ['react/jsx-dev-runtime']);
  assert.equal(FEEDBACK_SOURCE_RUNTIME, '@hachej/boring-feedback/source/jsx-dev-runtime');
});

test('the dev runtime bundles for the browser without process or Node APIs', async () => {
  const result = await build({
    entryPoints: [fileURLToPath(import.meta.resolve('@hachej/boring-feedback/source/jsx-dev-runtime'))],
    bundle: true, write: false, format: 'esm', platform: 'browser', external: ['react', 'react/*'], logLevel: 'silent',
  });
  const output = result.outputFiles[0].text;
  assert.match(output, /data-source/);
  assert.doesNotMatch(output, /\bprocess\b/);
  assert.doesNotMatch(output, /node:|\brequire\(/);
});
