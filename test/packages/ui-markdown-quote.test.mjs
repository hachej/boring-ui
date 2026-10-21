import assert from 'node:assert/strict';
import test from 'node:test';
import { captureMarkdownQuote, markdownQuoteResolution } from '@hachej/boring-ui-kit/markdown-quote';
import { runAnchorConformance } from '@hachej/boring-ui-kit/anchor-conformance';

const capture = (text, start, end) => { const result = captureMarkdownQuote(text, { start, end }); assert.equal(result.kind, 'captured'); return result.anchor; };
const range = (start, end) => ({ start, end });
export const quoteCorpus = [
  { name: 'unique exact source and moved paragraph', group: 'source', capture: { snapshot: 'A fictional passage.', anchor: capture('A fictional passage.', 2, 11) }, steps: [
    { name: 'unchanged', snapshot: 'A fictional passage.', evaluated: 'r1', expect: { kind: 'exact', range: range(2, 11) } },
    { name: 'moved', snapshot: 'Preface. A fictional passage.', evaluated: 'r2', expect: { kind: 'moved', range: range(11, 20) } },
    { name: 'deleted', snapshot: 'A passage.', evaluated: 'r3', expect: { kind: 'missing' } },
    { name: 'not fuzzy', snapshot: 'A Fictional passage.', evaluated: 'r4', expect: { kind: 'missing' } },
  ] },
  { name: 'identical duplicates cannot use stored offset as identity', group: 'duplicates', capture: { snapshot: 'echo', anchor: capture('echo', 0, 4) }, steps: [
    { name: 'repeated', snapshot: 'echo echo', evaluated: 'r5', expect: { kind: 'ambiguous', candidates: [range(0, 4), range(5, 9)] } },
    { name: 'one remains', snapshot: 'only echo', evaluated: 'r6', expect: { kind: 'moved', range: range(5, 9) } },
  ] },
  { name: 'exact context distinguishes duplicate quotes', group: 'duplicates', capture: { snapshot: 'Left echo right', anchor: capture('Left echo right', 5, 9) }, steps: [
    { name: 'context moved', snapshot: 'echo\nLeft echo right\necho', evaluated: 'r7', expect: { kind: 'moved', range: range(10, 14) } },
  ] },
  { name: 'literal Markdown, CRLF, BOM and Unicode', group: 'source', capture: { snapshot: '\uFEFF# Café\r\n\r\n**🪁** &amp;\r\n', anchor: capture('\uFEFF# Café\r\n\r\n**🪁** &amp;\r\n', 13, 15) }, steps: [
    { name: 'exact UTF16', snapshot: '\uFEFF# Café\r\n\r\n**🪁** &amp;\r\n', evaluated: 'r8', expect: { kind: 'exact', range: range(13, 15) } },
  ] },
  { name: 'overlapping exact occurrences', group: 'duplicates', capture: { snapshot: 'aa', anchor: capture('aa', 0, 2) }, steps: [
    { name: 'overlap', snapshot: 'aaa', evaluated: 'r9', expect: { kind: 'ambiguous', candidates: [range(0, 2), range(1, 3)] } },
  ] },
  { name: 'unknown version preserved as unsupported', group: 'version', capture: { snapshot: 'echo', anchor: { kind: 'markdown.quote@2', fallback: 'echo', future: ['kept'] } }, steps: [
    { name: 'unknown', snapshot: 'echo', evaluated: 'r10', expect: { kind: 'unsupported' } },
  ] },
];
test('markdown.quote@1 passes runAnchorConformance: zero wrong spots for the named exact-only corpus', () => {
  const report = runAnchorConformance({ resolution: markdownQuoteResolution, cases: quoteCorpus });
  assert.equal(report.passed, true, JSON.stringify(report.results)); assert.equal(report.wrongSpots, 0);
  console.log(JSON.stringify({ verdict: report.verdict, rates: report.rates }));
});
test('conformance detects an offset guess through the real resolver contract', () => {
  const report = runAnchorConformance({ resolution: { ...markdownQuoteResolution, resolve: (a, source, evaluated) => ({ kind: 'exact', range: { start: a.start, end: a.start + a.exact.length }, evaluated }) }, cases: quoteCorpus.slice(0, 2) });
  assert.equal(report.passed, false); assert.ok(report.wrongSpots > 0);
});
test('capture refuses empty, out-of-bounds and split-surrogate selections', () => {
  for (const [start, end] of [[0, 0], [-1, 1], [0, 9], [0, 1], [1, 2]]) assert.equal(captureMarkdownQuote('🪁', { start, end }).kind, 'refused');
});
