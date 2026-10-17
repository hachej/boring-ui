// Explicit presentation approval tool; never run by the test suite.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { composerCases } from '../test/fixtures/pi-chat-composer-cases.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = new URL('../.cache/composer-baseline/renderer.mjs', import.meta.url);
mkdirSync(new URL('.', output), { recursive: true });
await build({ stdin: { contents: "export { Composer } from './registry/pi-chat/composer.tsx';", resolveDir: root, loader: 'tsx' }, outfile: fileURLToPath(output), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
const { Composer } = await import(output.href);
const markup = Object.fromEntries(Object.entries(composerCases()).map(([name, props]) => [name, renderToStaticMarkup(createElement(Composer, props))]));
writeFileSync(new URL('../test/fixtures/pi-chat-composer-baseline.json', import.meta.url), `${JSON.stringify(markup, null, 2)}\n`);
console.log(`Updated ${Object.keys(markup).length} Composer presentation cases; review the diff and run the behavior tests.`);
