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
import { SidebarList } from '${join(root, 'registry/sidebar-list/sidebar-list.tsx')}';
import { SidebarProvider } from '${join(root, 'examples/app-shell/components/ui/sidebar.tsx')}';
import { ListRow } from '${join(root, 'registry/list-row/list-row.tsx')}';
import { InlineQuestion } from '${join(root, 'registry/inline-question/inline-question.tsx')}';
import { SegmentBar } from '${join(root, 'registry/expert-overview/expert-overview.tsx')}';
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
  listActive: (props) => renderToStaticMarkup(h(ListRow, { title: 'Invoice 12', ...props })),
  listAction: (props) => renderToStaticMarkup(h(ListRow, { title: 'Invoice 12', onSelect: () => {}, action: h('button', { 'aria-label': 'Cite' }, 'c'), ...props })),
  statTrend: (props) => renderToStaticMarkup(h(KpiStat, { label: 'Quotes', value: '17', ...props })),
  question: (props) => renderToStaticMarkup(h(InlineQuestion, { id: 'q', kind: 'question', text: 'Quel format ?', onAnswer: () => {}, ...props })),
  segments: (props) => renderToStaticMarkup(h(SegmentBar, { segments: [{ label: 'Shape', detail: 'criteria agreed' }, {}, {}, {}], current: 1, ...props })),
  sidebarList: (expanded) => renderToStaticMarkup(h(SidebarProvider, null, h(SidebarList, {
    label: 'Clients', action: { label: 'New client', icon: () => h('i'), onSelect: () => {} }, expanded,
    items: [
      { id: 'a', label: 'Acme', count: 3, active: true, onSelect: () => {}, children: [{ id: 'm', label: 'Moves', active: true, onSelect: () => {} }, { id: 'd', label: 'Requests', onSelect: () => {} }] },
      { id: 'b', label: 'Berg', count: 0, onSelect: () => {}, children: [{ id: 'x', label: 'Banks', onSelect: () => {} }] },
    ],
  }))),
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
  assert.match(up, /text-sm font-semibold tabular-nums/, 'the figure is sans with tabular numbers');
  assert.doesNotMatch(up, /font-mono/, 'a figure is not code (D-1742)');
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

test('ListRow active marks the current row with aria-current and the selected wash, and is off by default', () => {
  for (const props of [{}, { onSelect: () => {} }]) {
    const on = html.listActive({ ...props, active: true });
    assert.match(on, /aria-current="true"/);
    assert.match(on, /(?<![:\w-])bg-accent/);
    assert.doesNotMatch(html.listActive(props), /aria-current/);
  }
  assert.match(html.listSelect(), /Invoice 12/);
});

test('ListRow action sits beside the row button, never inside it, and shows on hover, focus and touch', () => {
  const markup = html.listAction();
  const row = markup.match(/<button[^>]*data-slot="button"[^>]*>[\s\S]*?<\/button>/)[0];
  assert.doesNotMatch(row, /aria-label="Cite"/, 'the action is not inside the row button');
  assert.match(markup, /data-testid="list-row-action"[^>]*>.*aria-label="Cite"/);
  assert.match(markup, /opacity-0/);
  assert.match(markup, /group-hover\/list-row:opacity-100/);
  assert.match(markup, /pointer-coarse:opacity-100/);
  assert.match(html.listAction({ onSelect: undefined }), /Invoice 12/);
  assert.doesNotMatch(html.listAction({ onSelect: undefined }), /<button[^>]*data-slot="button"/, 'a static row with an action stays static');
  const active = html.listAction({ active: true });
  assert.match(active, /aria-current="true"/);
  assert.match(active, /(?<![:\w-])bg-accent/);
  assert.doesNotMatch(html.listSelect(), /list-row-action/, 'no action, no wrapper');
});

test('InlineQuestion detail is one muted line under the question', () => {
  assert.doesNotMatch(html.question(), /question-detail/);
  const markup = html.question({ detail: 'Le client attend ce soir.' });
  assert.match(markup, /data-testid="question-detail"[^>]*>Le client attend ce soir\./);
  assert.match(markup, /text-muted-foreground[^"]*"[^>]*>Le client/);
  assert.ok(markup.indexOf('question-text') < markup.indexOf('question-detail'));
});

test('InlineQuestion info tone is the blue tint, with the chip; attention and neutral are unchanged', () => {
  const info = html.question({ tone: 'info' });
  assert.match(info, /bg-info-soft/);
  assert.match(info, /text-info-soft-foreground/);
  assert.doesNotMatch(info, /bg-warning-soft/);
  assert.match(info, /bg-card px-2/);
  assert.match(html.question({ tone: 'attention' }), /bg-warning-soft/);
  assert.doesNotMatch(html.question(), /bg-info-soft|bg-warning-soft/);
});

test('KpiStat trend draws a sparkline only for two readings or more', () => {
  assert.doesNotMatch(html.statTrend(), /<svg/);
  assert.doesNotMatch(html.statTrend({ trend: [3] }), /<svg/);
  assert.doesNotMatch(html.statTrend({ trend: [Number.NaN, 2] }), /<svg/);
  const markup = html.statTrend({ trend: [1, 3, 2, 5] });
  assert.match(markup, /data-testid="kpi-trend"/);
  assert.match(markup, /aria-hidden="true"/);
  assert.match(markup, /points="0,22 33.3,12 66.7,17 100,2"/);
  const said = html.statTrend({ trend: [1, 2], trendLabel: 'Rising over 7 days' });
  assert.match(said, /role="img"[^>]*aria-label="Rising over 7 days"|aria-label="Rising over 7 days"[^>]*role="img"/);
  assert.match(html.statTrend({ trend: [4, 4, 4] }), /points="0,12 50,12 100,12"/, 'a flat series sits mid-height');
});

test('SegmentBar is exported with segments, current and label, and shows detail only on hover', () => {
  const markup = html.segments({ label: 'Step 2 of 4' });
  assert.match(markup, /role="img"[^>]*aria-label="Step 2 of 4"|aria-label="Step 2 of 4"[^>]*role="img"/);
  assert.equal((markup.match(/data-segment="/g) ?? []).length, 4);
  assert.match(markup, /bg-info[^-]/);
  assert.match(markup, /data-segment-detail[^>]*>Shape: criteria agreed/);
  assert.match(markup, /opacity-0[^"]*group-hover\/segment:opacity-100/);
  assert.match(html.segments(), /aria-hidden="true"/, 'without a label the bar is decoration');
  assert.equal((html.segments({ segments: [{}, {}, {}], current: 3 }).match(/bg-info/g) ?? []).length, 3, 'three segments use the info colour');
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

test('SidebarList: avatar initial, count, the active row unfolds, one open row at a time', () => {
  const markup = html.sidebarList();
  assert.match(markup, /data-slot="avatar-fallback"[^>]*>A</, 'the initial of the label');
  assert.match(markup, /data-sidebar="menu-badge"[^>]*>3</, 'the count');
  assert.doesNotMatch(markup, /menu-badge[^>]*>0</, 'no pill for 0');
  assert.match(markup, /Moves/);
  assert.doesNotMatch(markup, /Banks/, 'the inactive row stays folded');
  assert.match(markup, /aria-label="New client"/);
  assert.match(markup, /title="Acme"/, 'a long label keeps its full text');
  const other = html.sidebarList('b');
  assert.match(other, /Banks/);
  assert.doesNotMatch(other, /Moves/, 'expanded overrides the active row');
});
