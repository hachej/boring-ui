// The pattern blocks (KpiStat, KpiRow, ListRow, EmptyState, PageHeader, DataTable) bundled as an app bundles them: the `@/components/ui`
// names resolve to the shadcn fixtures, the relative imports to the registry folders. Each is rendered to static markup and checked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const shadcn = join(root, 'examples/app-shell/components/ui');
const utils = join(root, 'examples/app-shell/lib/utils.ts');

const entry = `
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { kpiChange, KpiStat, KpiRow } from '${join(root, 'registry/kpi-stat/kpi-stat.tsx')}';
import { ListRow } from '${join(root, 'registry/list-row/list-row.tsx')}';
import { EmptyState } from '${join(root, 'registry/empty-state/blank-state.tsx')}';
import { PageHeader } from '${join(root, 'registry/page-header/page-header.tsx')}';
import { DataTable } from '${join(root, 'registry/data-table/data-table.tsx')}';
export { kpiChange };
export const html = {
  stat: () => renderToStaticMarkup(h(KpiStat, { label: 'Revenue', value: '€1,200', compare: { current: 120, previous: 100 } })),
  statFlat: () => renderToStaticMarkup(h(KpiStat, { label: 'Users', value: '42', compare: { current: 42, previous: 42 } })),
  row: () => renderToStaticMarkup(h(KpiRow, null, h(KpiStat, { label: 'A', value: '1' }))),
  listSelect: () => renderToStaticMarkup(h(ListRow, { title: 'Invoice 12', subtitle: 'Paid', trailing: '€40', onSelect: () => {} })),
  listStatic: () => renderToStaticMarkup(h(ListRow, { title: 'Invoice 12' })),
  empty: () => renderToStaticMarkup(h(EmptyState, { title: 'Nothing yet', hint: 'Add one to start', action: h('button', null, 'Add') })),
  header: () => renderToStaticMarkup(h(PageHeader, { title: 'Billing', badge: 'Beta', assistant: { opensIn: 'sheet', onOpen: () => {} } })),
  headerPanel: () => renderToStaticMarkup(h(PageHeader, { title: 'Billing', assistant: { opensIn: 'panel', onOpen: () => {} } })),
  table: () => renderToStaticMarkup(h(DataTable, {
    caption: 'Name, Amount',
    columns: [
      { id: 'name', header: 'Name', priority: 1, cell: r => r.name },
      { id: 'amount', header: 'Amount', priority: 2, numeric: true, cell: r => r.amount },
      { id: 'note', header: 'Note', priority: 3, cell: r => r.note },
    ],
    rows: [{ id: 'a', name: 'Acme', amount: '€40', note: 'late' }],
    rowKey: r => r.id,
  })),
};
`;

const dir = mkdtempSync(join(tmpdir(), 'pattern-blocks-'));
const entryFile = join(dir, 'entry.tsx');
const outfile = join(dir, 'bundle.cjs');
const plugin = {
  name: 'app-aliases',
  setup(b) {
    b.onResolve({ filter: /^@\/components\/ui\/(.+)$/ }, args => ({ path: join(shadcn, `${args.path.split('/').pop()}.tsx`) }));
    b.onResolve({ filter: /^@\/lib\/utils$/ }, () => ({ path: utils }));
  },
};

await build({
  stdin: { contents: entry, resolveDir: root, loader: 'tsx', sourcefile: entryFile },
  bundle: true, format: 'cjs', platform: 'node', outfile, write: true, logLevel: 'silent', jsx: 'automatic', plugins: [plugin],
  absWorkingDir: root,
});
const mod = createRequire(import.meta.url)(outfile);
test.after(() => rmSync(dir, { recursive: true, force: true }));
const { html } = mod;

test('kpiChange reports direction and whole percent, and nothing it cannot compare', () => {
  assert.deepEqual(mod.kpiChange(120, 100), { direction: 'up', percent: 20 });
  assert.deepEqual(mod.kpiChange(75, 100), { direction: 'down', percent: -25 });
  assert.equal(mod.kpiChange(100, 100), null, 'equal readings say nothing');
  assert.equal(mod.kpiChange(5, 0), null, 'no base to compare with');
  assert.equal(mod.kpiChange(Number.NaN, 10), null, 'non-finite input');
  assert.equal(mod.kpiChange(1000, 999), null, 'a change that rounds to 0% says nothing');
});

test('KpiStat shows a success delta up and a destructive one down, with a screen-reader word', () => {
  const up = html.stat();
  assert.match(up, /text-success/);
  assert.match(up, /<span class="sr-only">Up <\/span>/);
  assert.match(up, /\+20%/);
  assert.match(up, /font-mono text-sm font-semibold tabular-nums/);
  assert.doesNotMatch(html.statFlat(), /sr-only|text-success|text-destructive/, 'equal readings draw no delta');
});

test('KpiRow is one surface of tokens, not a card per stat', () => {
  const markup = html.row();
  assert.match(markup, /bg-card/);
  assert.match(markup, /rounded-\(--radius\)/);
  assert.doesNotMatch(markup, /border/);
});

test('ListRow with onSelect is a button, a static row is not', () => {
  assert.match(html.listSelect(), /<button[^>]*data-slot="button"/);
  assert.match(html.listSelect(), /Invoice 12/);
  assert.match(html.listSelect(), /truncate/);
  assert.doesNotMatch(html.listStatic(), /<button/);
  assert.match(html.listStatic(), /hover:bg-accent/);
});

test('EmptyState renders a plain column with its hint and action, no dashed border', () => {
  const markup = html.empty();
  assert.match(markup, /Nothing yet/);
  assert.match(markup, /Add one to start/);
  assert.match(markup, /<button[^>]*>Add<\/button>/);
  assert.doesNotMatch(markup, /border-dashed|rounded-xl/);
});

test('PageHeader trigger follows opensIn: panel icon or sheet icon, with a default label', () => {
  const sheet = html.header();
  assert.match(sheet, /<h1[^>]*>Billing<\/h1>/);
  assert.match(sheet, /Beta/);
  assert.match(sheet, /aria-label="[^"]+"/);
  assert.notEqual(sheet, html.headerPanel(), 'the two triggers draw different icons');
});

test('DataTable hides priority-3 cells on narrow widths and stacks below the container query', () => {
  const markup = html.table();
  assert.match(markup, /<table[^>]*table-fixed/);
  assert.match(markup, /@min-\[520px\]:table/);
  assert.match(markup, /hidden @min-\[720px\]:table-cell/);
  assert.match(markup, /@min-\[520px\]:hidden/);
  assert.doesNotMatch(markup, /overflow-x-auto/);
  assert.match(markup, /<dt[^>]*>Note<\/dt>/);
  assert.match(markup, /<caption[^>]*>Name, Amount<\/caption>/);
});
