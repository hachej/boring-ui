// `design-no-x-scroll`: a file that renders a table must not also hold a horizontal scroll container. The rule is file-scoped and lexical.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DESIGN_RULES, APP_RULES, noXScroll, scanDesign } from '../../packages/ui/bin/boring-ui-blocks.mjs';

const hits = text => scanDesign('registry/x/x.tsx', text, [['design-no-x-scroll', noXScroll]]).map(finding => finding.value);

test('a raw table beside an overflow-x-auto wrapper is a finding', () => {
  assert.deepEqual(hits('<div className="overflow-x-auto"><table><tr /></table></div>'), ['overflow-x-auto']);
});

test('the shadcn table import makes the file a table file, so its wrapper is caught', () => {
  assert.deepEqual(hits("import { Table } from '@/components/ui/table'\nexport const x = <div className=\"overflow-x-scroll\" />"), ['overflow-x-scroll']);
  assert.deepEqual(hits("import { DataTable } from '../data-table/data-table'\nconst s = { overflowX: 'auto' }\n<Table />"), ['overflowX: \'auto']);
});

test('the CSS property and the role=table attribute both count as a table', () => {
  assert.deepEqual(hits('.grid { display: table; overflow-x: auto; }'), ['overflow-x: auto']);
  assert.deepEqual(hits('<div role="table" className="overflow-x-auto" />'), ['overflow-x-auto']);
});

test('no table in the file means no finding, whatever the scroll container', () => {
  assert.deepEqual(hits('<div className="overflow-x-auto"><pre>code</pre></div>'), []);
});

test('a table without a horizontal scroll container is clean', () => {
  assert.deepEqual(hits('<DataTable caption="x" columns={[]} rows={[]} rowKey={() => "a"} />'), []);
  assert.deepEqual(hits('<table className="w-full table-fixed"><tr /></table>'), []);
});

test('overflow-y and similarly named classes do not match', () => {
  assert.deepEqual(hits('<table /><div className="overflow-y-auto overflow-x-hidden overflow-x-auto-foo" />'), []);
});

test('the rule is registered in both the design and the app profiles', () => {
  assert.ok(DESIGN_RULES.some(([rule, pattern]) => rule === 'design-no-x-scroll' && pattern === noXScroll));
  assert.ok(APP_RULES.some(([rule, pattern]) => rule === 'design-no-x-scroll' && pattern === noXScroll));
});

test('the pi-chat markdown code block is allowlisted by an exception', () => {
  const allow = JSON.parse(readFileSync(new URL('../../scripts/design-allowlist.json', import.meta.url), 'utf8'));
  const entry = allow.allow.find(item => item.file === 'registry/pi-chat-markdown/markdown.tsx' && item.rules.includes('design-no-x-scroll'));
  assert.ok(entry, 'the pi-chat markdown exception exists');
  assert.equal(entry.pattern, '^overflow-x-auto$');
  assert.equal(entry.exception, 'editor-document');
});
