// Writes the demo's browser side into ./public/ (Workers static assets): the same page, bundle, stylesheet, pdf.js worker and brand theme the
// Node server serves (../assets.mjs). The page bootstraps from /api/session.js, which the Worker answers for the visitor's own session.
// Run `npm run build` first (the packages are consumed from dist).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkspaceDemoAssets } from '../assets.mjs';

const out = fileURLToPath(new URL('./public', import.meta.url));
const { files, page } = await buildWorkspaceDemoAssets();
const written = { ...Object.fromEntries(Object.entries(files).map(([path, [, body]]) => [path, body])), '/index.html': page('<script src="/api/session.js"></script>') };
for (const [path, body] of Object.entries(written)) {
  mkdirSync(dirname(`${out}${path}`), { recursive: true });
  writeFileSync(`${out}${path}`, body);
}
console.log(`Built ${out}: ${Object.keys(written).join(', ')}`);
