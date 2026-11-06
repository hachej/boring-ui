import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Resolve the actual transform dependency of the repository-pinned CLI, not a copied transform.
const requireCli = createRequire(createRequire(import.meta.url).resolve('shadcn'));
const { transform } = await import(pathToFileURL(requireCli.resolve('@shadcn/registry/internal/transformers/index')));
const { transformRsc } = await import(pathToFileURL(requireCli.resolve('@shadcn/registry/internal/transformers/transform-rsc')));
const evidenceRoot = join(root, '.cache/evidence/astra-round3-fixes');
mkdirSync(evidenceRoot, { recursive: true });
const evidence = mkdtempSync(join(evidenceRoot, 'rsc-installed-'));
const hasClientBoundary = raw => {
  const source = ts.createSourceFile('icons.ts', raw, ts.ScriptTarget.Latest, true);
  for (const node of source.statements) {
    if (!ts.isExpressionStatement(node) || !ts.isStringLiteral(node.expression)) break;
    if (node.expression.text === 'use client') return true;
  }
  return false;
};

test('pinned shadcn RSC install transform preserves the shared client boundary for server-eligible blocks', async () => {
  assert.equal(JSON.parse(readFileSync(requireCli.resolve('../package.json'), 'utf8')).version, '4.23.0');
  const installed = new Map();
  for (const name of ['_shared', 'kpi-stat', 'empty-state', 'utils']) {
    const item = JSON.parse(readFileSync(join(root, 'public/r', `${name}.json`), 'utf8'));
    for (const file of item.files) {
      const raw = await transform({ filename: file.target, raw: file.content, config: { rsc: true } }, [transformRsc]);
      const target = join(evidence, file.target);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, raw);
      installed.set(file.path, raw);
    }
  }
  const adapter = installed.get('registry/_shared/icons.ts');
  assert.ok(hasClientBoundary(adapter), 'Phosphor root uses React context: installed shared module must declare use client');
  const source = readFileSync(join(root, 'registry/_shared/icons.ts'), 'utf8');
  const published = JSON.parse(readFileSync(join(root, 'public/r/_shared.json'), 'utf8')).files[0].content;
  assert.equal(published, source, 'distributed boundary matches source');
  assert.equal(await transformRsc(source, { filename: 'icons.ts', config: { rsc: true } }), source, 'RSC-specific installer transform leaves source unchanged');
  for (const path of ['registry/kpi-stat/kpi-stat.tsx', 'registry/empty-state/blank-state.tsx']) {
    const raw = installed.get(path);
    assert.equal(hasClientBoundary(raw), false, `${path} stays server eligible`);
    assert.match(raw, /from ['"]\.\.\/_shared\/icons['"]/);
  }
  // The pinned transform is not a compiler: rsc:true does not repair a missing directive.
  const missingBoundary = adapter.replace(/^['"]use client['"];?\s*/, '');
  assert.equal(hasClientBoundary(await transform({ filename: 'icons.ts', raw: missingBoundary, config: { rsc: true } }, [transformRsc])), false);
  writeFileSync(join(evidence, 'qualification.json'), JSON.stringify({ cli: 'shadcn@4.23.0', rsc: true, boundary: 'source directive preserved by real pinned install transform', fullNextRscApplication: 'not run; no RSC compiler/Flight qualification claimed' }, null, 2));

  // Ordinary SSR is a separate check of actual transformed/copied blocks and native SVGs.
  const outfile = join(evidence, 'ordinary-ssr.mjs');
  await build({ stdin: { contents: `export * as icons from './components/_shared/icons'; export { KpiStat } from './components/kpi-stat/kpi-stat'; export { EmptyState } from './components/empty-state/blank-state';`, resolveDir: evidence, loader: 'tsx' }, outfile, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external' });
  const { icons, KpiStat, EmptyState } = await import(pathToFileURL(outfile));
  assert.equal(Object.keys(icons).length, 131, 'existing symbol surface unchanged');
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(KpiStat, { label: 'Fictional total', value: '12', compare: { current: 12, previous: 10 } }),
    React.createElement(EmptyState, { title: 'No fictional entries', hint: 'Add one to begin.' })));
  assert.match(html, /Fictional total/);
  assert.match(html, /No fictional entries/);
  assert.equal((html.match(/viewBox="0 0 256 256"/g) ?? []).length, 2);
  writeFileSync(join(evidence, 'ordinary-ssr.html'), html);
});
