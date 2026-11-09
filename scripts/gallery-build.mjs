// D-2012: builds the kit gallery (demos/gallery) into ONE self-contained HTML file: the JS and the CSS inline, the mono font embedded, no external URL.
// It is the build the browser fixtures use (test/contracts/composer-content.test.mjs): esbuild with the kit-source resolver, then the `theme` item's tokens
// and the registry items' css compiled with Tailwind over the classes found in the bundled sources.
//   npm run gallery:build            -> .cache/gallery/index.html
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'tailwindcss';
import { registryCss } from '../lab/studio/tailwind.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');

// The registry items whose css the gallery's blocks need (an item without css is skipped).
const ITEMS = ['touch-floor', 'utils', 'button', 'app-shell', 'pi-chat', 'pi-chat-markdown', 'pi-chat-slash', 'pi-chat-mentions', 'pi-chat-pickers', 'pi-chat-voice', 'pi-chat-attachments', 'pi-chat-question', 'pi-chat-approval', 'pi-chat-subagent', 'pi-artifacts', 'pi-chat-plugins', 'file-pick', 'space-card', 'inline-question', 'status-narrative', 'data-table'];

/** The kit's sources as an app resolves them: the shadcn layer for `@/components/ui/*`, the kit package's src for `@hachej/boring-ui-kit/*`. */
function kitSources() {
  const exported = JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8')).exports;
  return { name: 'kit-sources', setup(builder) {
    builder.onResolve({ filter: /^@\/hooks\/use-mobile$/ }, () => ({ path: join(root, 'shadcn/ui/use-mobile.ts') }));
    builder.onResolve({ filter: /^@\/components\/ui\// }, args => ({ path: join(root, 'shadcn/ui', `${args.path.split('/').at(-1)}.tsx`) }));
    builder.onResolve({ filter: /^@hachej\/boring-ui-kit\// }, args => {
      const target = exported[`./${args.path.slice('@hachej/boring-ui-kit/'.length)}`]?.import;
      const base = join(root, 'packages/ui/src', String(target).replace(/^\.\/dist\//, '').replace(/\.js$/, ''));
      return { path: ['.ts', '.tsx'].map(ext => base + ext).find(existsSync) };
    });
    builder.onResolve({ filter: /^@hachej\/boring-feedback\/ui$/ }, () => ({ path: join(root, 'packages/feedback/src/ui/index.ts') }));
  } };
}

/** The Geist Mono variable font (a dependency of the `theme` item) as an embedded @font-face; none when the package is not installed. */
function monoFont() {
  const directory = join(root, 'node_modules/@fontsource-variable/geist-mono/files');
  const file = existsSync(directory) ? readdirSync(directory).find(name => /latin-wght-normal\.woff2$/.test(name)) : undefined;
  if (!file) return '';
  const data = readFileSync(join(directory, file)).toString('base64');
  return `@font-face { font-family: 'Geist Mono'; font-style: normal; font-weight: 100 900; font-display: swap; src: url(data:font/woff2;base64,${data}) format('woff2'); }`;
}

/** A script or style body safe to put inside its tag. */
const inline = text => text.replaceAll('</script', '<\\/script').replaceAll('</style', '<\\/style').replaceAll('<!--', '<\\!--');

/** Builds the gallery and returns `{ html }`; writes it to `outFile` when given. */
export async function buildGallery({ outFile } = {}) {
  const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
  const item = name => registry.items.find(entry => entry.name === name);
  const bundle = await build({ entryPoints: [join(root, 'demos/gallery/gallery.jsx')], bundle: true, write: false, metafile: true, format: 'iife', platform: 'browser', jsx: 'automatic', minify: true, legalComments: 'none', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kitSources()], logLevel: 'silent' });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(path => /\.(tsx?|jsx)$/.test(path) && !path.includes('node_modules')).map(path => readFileSync(join(root, path), 'utf8'));
  const vars = item('theme').cssVars;
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${['theme', ...ITEMS].map(item).filter(Boolean).map(registryCss).join('\n')}`;
  const compiler = await compile(cssSource, { base: root, loadStylesheet: async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  } });
  const css = `${monoFont()}\n${compiler.build(sources.flatMap(source => source.split(/[\s"'`]+/)))}`;
  // The ids let the phone preview rebuild this page inside its 390px frame.
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Galerie du kit</title><link rel="icon" href="data:,"><style id="gallery-css">${inline(css)}</style></head><body><div id="root"></div><script id="gallery-js">${inline(js)}</script></body></html>\n`;
  if (outFile) { mkdirSync(dirname(outFile), { recursive: true }); writeFileSync(outFile, html); }
  return { html };
}

if (process.argv[1] && join(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outFile = join(root, '.cache/gallery/index.html');
  const { html } = await buildGallery({ outFile });
  console.log(`gallery: ${outFile} (${(html.length / 1024).toFixed(0)} KiB)`);
}
