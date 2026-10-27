import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildTailwind } from '../../lab/studio/tailwind.mjs';

/** Browser-only fictional task board: no agent, credentials, files or remote services. */
export async function startTaskBoard({ port = 0 } = {}) {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('./page.tsx', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', alias: { '@': fileURLToPath(new URL('../app-shell', import.meta.url)) }, define: { 'process.env.NODE_ENV': '"production"' }, minify: true, logLevel: 'silent', metafile: true });
  const css = await buildTailwind({ extraDirectories: ['examples/task-board', 'registry/task-board'], extraCss: '@layer base { @import "tailwindcss/preflight.css"; }' });
  const page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fictional task board</title><link rel="stylesheet" href="/app.css"></head><body class="m-0 bg-background text-foreground font-sans"><div id="root"></div><script type="module" src="/page.js"></script></body></html>';
  const statics = { '/': ['text/html; charset=utf-8', page], '/page.js': ['text/javascript', bundle.outputFiles[0].contents], '/app.css': ['text/css', css] };
  const server = createServer((request, response) => {
    const entry = request.method === 'GET' && statics[new URL(request.url, 'http://fictional.invalid').pathname];
    if (!entry) return void response.writeHead(404).end();
    response.writeHead(200, { 'content-type': entry[0], 'cache-control': 'no-store' }).end(entry[1]);
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  return { url: `http://127.0.0.1:${server.address().port}/`, metafile: bundle.metafile, close: async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startTaskBoard({ port: Number(process.env.PORT ?? 4321) }); console.log(`Fictional task board: ${app.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().finally(() => process.exit(0)); });
}
