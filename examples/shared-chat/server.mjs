import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildTailwind } from '../../lab/studio/tailwind.mjs';
import { stockShadowTokens, themePreviewHead, themePreviewStatics } from '../../test/fixtures/themes/preview.mjs';

const here = name => fileURLToPath(new URL(name, import.meta.url));
/** A disposable fictional page. No credentials, model, Pi execution or external service. */
export async function startSharedChat({ port = 0 } = {}) {
  const bundle = await build({ entryPoints: [here('./page.jsx')], bundle: true, write: false, outdir: here('./out'), format: 'esm', platform: 'browser', jsx: 'automatic',
    alias: { '@': here('../app-shell') }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const css = [await buildTailwind({ extraDirectories: ['examples/shared-chat', 'test/fixtures/themes'] }), ...bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text),
    'html,body,#root{height:100%;margin:0}body{background:var(--background);color:var(--foreground);font-family:var(--font-sans,ui-sans-serif,system-ui,sans-serif)}', stockShadowTokens].join('\n');
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Shared conversations, fictional demo</title><link rel="stylesheet" href="/app.css">${themePreviewHead}</head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;
  const statics = { ...themePreviewStatics, '/': ['text/html; charset=utf-8', page], '/app.js': ['text/javascript', bundle.outputFiles.find(file => file.path.endsWith('.js')).text], '/app.css': ['text/css', css] };
  const server = createServer((request, response) => {
    const file = request.method === 'GET' && statics[new URL(request.url, `http://${request.headers.host}`).pathname];
    if (!file) return void response.writeHead(404).end();
    response.writeHead(200, { 'content-type': file[0], 'cache-control': 'no-store' }).end(file[1]);
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startSharedChat({ port: Number(process.env.PORT ?? 0) });
  console.log(`Fictional shared chat at ${app.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().finally(() => process.exit(0)); });
}
