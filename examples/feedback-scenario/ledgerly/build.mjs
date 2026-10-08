// Ledgerly's own development build, as an outside application would write it: esbuild with the feedback source plugin, so every
// intrinsic element carries data-source="<file>:<line>" and picker labels and reports name the component. Production builds must not
// use the plugin (it refuses mode: 'production').
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { feedbackSourcePlugin } from '@hachej/boring-feedback/source';

const root = process.cwd();
mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/main.jsx'], bundle: true, outdir: 'dist', format: 'esm', platform: 'browser', logLevel: 'warning',
  jsx: 'automatic', jsxDev: true, absWorkingDir: root, plugins: [feedbackSourcePlugin({ root, mode: 'development' })],
  define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.js': 'jsx' }, metafile: true,
}).then(result => writeFileSync('dist/meta.json', JSON.stringify(result.metafile)));
writeFileSync('dist/index.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ledgerly</title><link rel="stylesheet" href="/main.css"></head>
<body><div id="root"></div><script type="module" src="/main.js"></script></body></html>
`);
console.log('built dist/main.js and dist/main.css');
