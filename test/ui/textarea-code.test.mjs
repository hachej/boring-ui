import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));

// D-1782: the kit Textarea has one monospace variant, for source text and pasted payloads.
test('Textarea variant="code" renders font-mono, no ligatures and a tab width; the default variant renders none of them', async () => {
  const out = `${root}.cache/textarea-code/`; mkdirSync(out, { recursive: true });
  await build({
    stdin: { contents: `export { Textarea } from '${root}shadcn/ui/textarea';`, resolveDir: root, loader: 'tsx' },
    outfile: `${out}bundle.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external',
  });
  const { Textarea } = await import(`file://${out}bundle.mjs`);
  const { createElement: h } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const code = renderToStaticMarkup(h(Textarea, { variant: 'code', className: 'min-h-32', defaultValue: '{}' }));
  const classes = /class="([^"]*)"/.exec(code)[1].split(/\s+/);
  for (const token of ['font-mono', '[font-variant-ligatures:none]', '[tab-size:2]', 'min-h-32']) assert.ok(classes.includes(token), `${token} in ${code}`);
  assert.ok(!/variant=/.test(code), 'the variant is a prop, not a DOM attribute');
  const plain = renderToStaticMarkup(h(Textarea, { defaultValue: '{}' }));
  for (const token of ['font-mono', '[font-variant-ligatures:none]', '[tab-size:2]']) assert.ok(!plain.includes(token), `${token} only on the code variant`);
});
