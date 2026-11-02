// The demo's browser side, built once for both hosts: the page bundle (./page.tsx), its stylesheet, pdf.js's worker and the brand theme preview.
// The Node server serves these from memory; the Cloudflare build (./cloudflare/build.mjs) writes them as Workers static assets. Node only.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildTailwind } from '../../lab/studio/tailwind.mjs';
import { stockShadowTokens, themePreviewHead, themePreviewStatics } from '../../test/fixtures/themes/preview.mjs';
import { COMPANY } from './data.mjs';

const here = name => fileURLToPath(new URL(name, import.meta.url));

/**
 * `files`: path → [content type, body] for every static file the page loads. `page(bootstrap)`: the HTML, where `bootstrap` is the script
 * tag that sets `window.__APP__` before the bundle runs (inline on the Node server, `/api/session.js` on the Worker).
 */
export async function buildWorkspaceDemoAssets() {
  const bundle = await build({ entryPoints: [here('./page.tsx')], bundle: true, write: false, outdir: here('./out'), format: 'esm', platform: 'browser', jsx: 'automatic',
    alias: { '@': here('../../examples/app-shell') }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const css = [await buildTailwind({ extraDirectories: ['demos/workspace', 'packages/ui/src', 'registry/pi-chat-voice', 'registry/dock', 'registry/pi-app', 'registry/documents', 'registry/viewer-frame', 'registry/viewer-markdown', 'registry/viewer-html', 'registry/viewer-image', 'registry/viewer-pdf', 'registry/viewer-code', 'registry/maquette-viewer', 'registry/diagram-viewer', 'registry/record-viewer', 'registry/mockup-viewer', 'examples/app-shell/components', 'examples/app-shell/hooks'], extraCss: readFileSync(here('./style.css'), 'utf8') }), ...bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text),
    '@layer base{*,::before,::after{box-sizing:border-box}ul,ol{list-style:none;margin:0;padding:0}h1,h2,h3,p{margin:0}button{border:0;background:transparent;padding:0;font:inherit;color:inherit;cursor:pointer}button:disabled{cursor:default}}',
    'html,body,#root{height:100%;margin:0}body{background:var(--background);color:var(--foreground);font:14px/1.5 var(--font-sans,ui-sans-serif,system-ui,sans-serif)}', stockShadowTokens].join('\n');
  const page = bootstrap => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${COMPANY} - Accounts payable (fictional)</title>
<link rel="stylesheet" href="/app.css">${themePreviewHead}</head><body><div id="root"></div>${bootstrap}
<script type="module" src="/app.js"></script></body></html>`;
  const files = { ...themePreviewStatics, '/app.js': ['text/javascript; charset=utf-8', bundle.outputFiles.find(file => file.path.endsWith('.js')).text], '/app.css': ['text/css; charset=utf-8', css],
    // pdf.js's worker at the URL the bundle resolves (esbuild leaves `new URL(<package path>, import.meta.url)` as is), for browsers without a PDF viewer.
    '/pdfjs-dist/build/pdf.worker.min.mjs': ['text/javascript; charset=utf-8', readFileSync(fileURLToPath(import.meta.resolve('pdfjs-dist/build/pdf.worker.min.mjs')))] };
  return { files, page };
}
