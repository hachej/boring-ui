// Builds the browser app into examples/cloudflare/public/ (served as Workers static assets): one ES module, one stylesheet, one page.
// Uses the same Tailwind library build and shadcn tokens as the studio. Run `npm run build` first (the packages are consumed from dist).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildTailwind } from '../../studio/tailwind.mjs';
import { describeScenario, loadScenarios } from '../../studio/scenarios/index.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const out = here('../public');
mkdirSync(out, { recursive: true });

const bundle = await build({ entryPoints: [here('../browser/app.jsx')], bundle: true, write: false, outdir: out, format: 'esm', platform: 'browser', jsx: 'automatic',
  minify: true, loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const tailwind = await buildTailwind();
const styles = [tailwind, ...bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text), readFileSync(here('../browser/styles.css'), 'utf8')].join('\n');

// The scenario list is data: the same files the studio lists and the journey executes, described without their code or fixtures.
const scenarios = (await loadScenarios()).map(describeScenario);
writeFileSync(`${out}/scenarios.json`, JSON.stringify(scenarios));
writeFileSync(`${out}/app.js`, script);
writeFileSync(`${out}/styles.css`, styles);
writeFileSync(`${out}/index.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content"><title>Assistant on Cloudflare (fictional)</title>
<link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);
console.log(`Built ${out}: scenarios.json (${scenarios.length}), app.js ${(script.length / 1024).toFixed(0)} KiB, styles.css ${(styles.length / 1024).toFixed(0)} KiB`);
