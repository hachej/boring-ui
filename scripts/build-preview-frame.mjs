// Bundles scripts/preview-frame/frame.tsx (React, sucrase, the small kit) into registry/live-preview/preview-frame.js, the one script of the
// sandboxed preview frame. `npm run registry:build` runs it; a test fails when the committed file differs from a fresh build.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
export const FRAME_JS = `${root}registry/live-preview/preview-frame.js`;

export async function buildPreviewFrame() {
  const result = await build({ entryPoints: [`${root}scripts/preview-frame/frame.tsx`], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
    minify: true, legalComments: 'none', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  return result.outputFiles[0].text;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = await buildPreviewFrame();
  writeFileSync(FRAME_JS, text);
  console.log(`Built registry/live-preview/preview-frame.js (${text.length} bytes)`);
}
