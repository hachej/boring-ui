// Builds one fixture (a .jsx page that mounts a layout or a component from registry/) into ONE self-contained HTML page: no network, no server.
// Same recipe as test/contracts/one-composer.test.mjs: esbuild for the sources, Tailwind compiled over exactly the sources the page uses.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'package.json'));
const BASE_CSS = ['theme', 'app-shell', 'pi-chat', 'pi-chat-mentions', 'pi-chat-attachments', 'pi-chat-slash', 'agent-bar', 'file-tree'];
const block = vars => Object.entries(vars).map(([key, value]) => `--${key}: ${value};`).join('\n');

export async function buildPage(entry, outFile, { css: extraCss = [], title = 'boring-ui' } = {}) {
  const { build } = require('esbuild');
  const { compile } = require('tailwindcss');
  const { registryCss } = await import(pathToFileURL(join(root, 'lab/studio/tailwind.mjs')).href);
  const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
  const item = name => registry.items.find(entry => entry.name === name);
  const exported = JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8')).exports;
  const kit = { name: 'kit-sources', setup(b) {
    b.onResolve({ filter: /^@\/hooks\/use-mobile$/ }, () => ({ path: join(root, 'shadcn/ui/use-mobile.ts') }));
    b.onResolve({ filter: /^@\/components\/ui\// }, a => ({ path: join(root, 'shadcn/ui', `${a.path.split('/').at(-1)}.tsx`) }));
    b.onResolve({ filter: /^@hachej\/boring-ui-kit\// }, a => {
      const target = exported[`./${a.path.slice('@hachej/boring-ui-kit/'.length)}`]?.import;
      const base = join(root, 'packages/ui/src', String(target).replace(/^\.\/dist\//, '').replace(/\.js$/, ''));
      return { path: ['.ts', '.tsx'].map(ext => base + ext).find(existsSync) };
    });
    b.onResolve({ filter: /^@hachej\/boring-feedback\/ui$/ }, () => ({ path: join(root, 'packages/feedback/src/ui/index.ts') }));
  } };
  const bundle = await build({ entryPoints: [join(root, entry)], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'empty' }, plugins: [kit], logLevel: 'silent', absWorkingDir: root, nodePaths: [join(root, 'node_modules')] });
  const js = bundle.outputFiles[0].text;
  const sources = Object.keys(bundle.metafile.inputs).filter(p => /\.(tsx?|jsx)$/.test(p) && !p.includes('node_modules')).map(p => readFileSync(join(root, p), 'utf8'));
  const vars = item('theme').cssVars;
  const names = [...new Set([...BASE_CSS, ...extraCss])];
  const cssSource = `@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n:root {${block(vars.light)}}\n.dark {${block(vars.dark)}}\n@theme inline {${block(vars.theme)}}\n@layer base { * { @apply border-border; } body { @apply bg-background text-foreground font-sans text-xs; } }\n${names.map(n => registryCss(item(n))).join('\n')}\n${readFileSync(join(root, 'packages/ui/styles/file-tree.css'), 'utf8')}`;
  const compiler = await compile(cssSource, { base: root, loadStylesheet: async id => {
    const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id);
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') };
  } });
  const css = compiler.build(sources.flatMap(s => s.split(/[\s"'`]+/)));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>${title}</title><style>${css}</style></head><body><div id="root"></div><script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);
  return outFile;
}
