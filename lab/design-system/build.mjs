// Builds the Boring design system overview page: ONE self-contained HTML file (inline JS and CSS, fonts as data URIs, no request).
// The page renders the real kit: registry blocks plus the shadcn parts they use. Run `npm run design:gallery`.
// Output: .cache/design-system.html (git-ignored). Geist and Geist Mono are embedded when found (GEIST_DIR, or a sibling project's
// @fontsource-variable packages); otherwise the page falls back to the system fonts and the build says so.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildTailwind, registryCss } from '../studio/tailwind.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const here = path => fileURLToPath(new URL(path, import.meta.url));
const out = resolve(root, process.argv[2] ?? '.cache/design-system.html');

/** `@hachej/boring-*` resolve to their TypeScript sources through each package's export map (dist is not built for the gallery). */
const workspacePlugin = {
  name: 'workspace-sources',
  setup(b) {
    b.onResolve({ filter: /^@hachej\/boring-[a-z-]+(\/.*)?$/ }, args => {
      const [, name, sub = ''] = /^@hachej\/(boring-[a-z-]+)(\/.*)?$/.exec(args.path);
      const directory = name === 'boring-ui-kit' ? 'ui' : name.replace('boring-', '');
      const manifest = JSON.parse(readFileSync(join(root, 'packages', directory, 'package.json'), 'utf8'));
      const entry = manifest.exports?.[sub ? `.${sub}` : '.'];
      const target = typeof entry === 'string' ? entry : entry?.import ?? entry?.default;
      if (!target) return { errors: [{ text: `no export ${args.path}` }] };
      if (!target.startsWith('./dist/')) return { path: join(root, 'packages', directory, target) };
      const base = join(root, 'packages', directory, target.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, ''));
      const found = ['.ts', '.tsx'].map(ext => base + ext).find(existsSync);
      return found ? { path: found } : { errors: [{ text: `no source for ${args.path}` }] };
    });
  },
};
/** `@/components/ui/x` is the kit's pinned shadcn fixture; parts the fixture lacks (tabs, select) come from the stock `shadcn/ui` folder. */
const aliasPlugin = {
  name: 'app-alias',
  setup(b) {
    b.onResolve({ filter: /^cn$/ }, () => ({ path: join(root, 'examples/app-shell/lib/utils.ts') }));
    b.onResolve({ filter: /^@\// }, args => {
      const sub = args.path.slice(2);
      const candidates = [join(root, 'examples/app-shell', sub), join(root, sub.replace(/^components\/ui\//, 'shadcn/ui/')), join(root, sub.replace(/^components\//, 'registry/'))];
      for (const base of candidates) for (const ext of ['.tsx', '.ts', '/index.ts', '/index.tsx']) if (existsSync(base + ext)) return { path: base + ext };
      return { errors: [{ text: `cannot resolve ${args.path}` }] };
    });
  },
};

function fontFaces() {
  const candidates = [process.env.GEIST_DIR, join(root, 'node_modules/@fontsource-variable'), '/home/ubuntu/projects/boring-ui-v2/node_modules/@fontsource-variable'].filter(Boolean);
  const base = candidates.find(dir => existsSync(join(dir, 'geist/files/geist-latin-wght-normal.woff2')));
  if (!base) { console.warn('Geist not found: the page falls back to system fonts (set GEIST_DIR to an @fontsource-variable folder).'); return ''; }
  const face = (family, file) => `@font-face{font-family:'${family}';font-weight:100 900;font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${readFileSync(join(base, file)).toString('base64')}) format('woff2')}`;
  return face('Geist', 'geist/files/geist-latin-wght-normal.woff2') + face('Geist Mono', 'geist-mono/files/geist-mono-latin-wght-normal.woff2');
}

const subdirs = directory => readdirSync(join(root, directory)).filter(name => statSync(join(root, directory, name)).isDirectory()).map(name => `${directory}/${name}`);
const manifest = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));

const bundle = await build({
  entryPoints: [here('./gallery.tsx')], bundle: true, write: false, outdir: here('./out'), format: 'iife', platform: 'browser', jsx: 'automatic', minify: true,
  conditions: ['browser', 'import'], mainFields: ['browser', 'module', 'main'], plugins: [workspacePlugin, aliasPlugin], logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.html': 'text', '.woff2': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' },
});
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const bundledCss = bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');

const itemCss = manifest.items.filter(item => item.css && !['theme'].includes(item.name)).map(registryCss).join('\n');
// shadcn/tailwind.css is the import `shadcn init` adds to an app's globals.css: the data-open, data-active, data-horizontal ... variants.
const tailwind = await buildTailwind({ extraDirectories: [...subdirs('registry'), 'shadcn/ui', 'lab/design-system'], extraCss: `@import "shadcn/tailwind.css";\n${itemCss}` });
// The gallery's own toggle decides the mode: the OS preference must not switch `dark:` utilities behind it.
const css = [fontFaces(), tailwind.replace(/@media \(prefers-color-scheme: ?dark\)/g, '@media not all'), bundledCss, readFileSync(here('./gallery.css'), 'utf8')].join('\n');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Boring design system, default style v1</title>
<style id="gallery-css">${css}</style></head><body><div id="root"></div><script id="gallery-js">${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${out} (${(html.length / 1024).toFixed(0)} KiB)`);
