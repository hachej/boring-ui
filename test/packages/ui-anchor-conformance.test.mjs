import assert from 'node:assert/strict';
import test from 'node:test';
import { ANCHOR_CONFORMANCE_VERDICT, runAnchorConformance } from '@hachej/boring-ui-kit/anchor-conformance';
import { lineResolution } from '../fixtures/anchors/synthetic/line-adapter.mjs';
import { CORPUS_NAME, syntheticCorpus } from '../fixtures/anchors/synthetic/corpus.mjs';

const REQUIRED_GROUPS = ['move', 'duplicate', 'delete', 'deletion-then-similar', 'reused-identity', 'unknown-kind'];
const failures = report => report.results.flatMap(result => result.failures);

test(`synthetic test.line@1 passes the ${CORPUS_NAME} corpus with zero wrong spots`, () => {
  const report = runAnchorConformance({ resolution: lineResolution, cases: syntheticCorpus });
  assert.deepEqual(failures(report), []);
  assert.equal(report.passed, true);
  assert.equal(report.wrongSpots, 0);
  assert.equal(report.verdict, ANCHOR_CONFORMANCE_VERDICT);
  assert.equal(report.verdict, 'zero wrong spots for the named corpus');
  assert.deepEqual(Object.keys(report.rates).sort(), [...REQUIRED_GROUPS].sort());
  for (const group of REQUIRED_GROUPS) assert.equal(report.rates[group].wrongSpots, 0, group);
  // Rates are reported, never thresholded: the honest adapter places nothing automatically after a deletion.
  assert.equal(report.rates.delete.automatic, 0);
  assert.equal(report.rates['unknown-kind'].placements.unsupported, 2);
  assert.equal(report.rates.move.placements.moved, 2);
  assert.ok(report.rates.duplicate.placements.ambiguous >= 2);
});

test('a nearest-candidate guesser fails readably on ambiguous cases', () => {
  const guesser = {
    ...lineResolution,
    resolve(anchor, snapshot, evaluated) {
      const placement = lineResolution.resolve(anchor, snapshot, evaluated);
      if (placement.kind !== 'ambiguous') return placement;
      const [nearest] = [...placement.candidates].sort((a, b) => Math.abs(a.line - anchor.line) - Math.abs(b.line - anchor.line));
      return { kind: nearest.line === anchor.line ? 'exact' : 'moved', range: nearest, evaluated };
    },
  };
  const report = runAnchorConformance({ resolution: guesser, cases: syntheticCorpus });
  assert.equal(report.passed, false);
  assert.ok(report.wrongSpots > 0);
  assert.notEqual(report.verdict, ANCHOR_CONFORMANCE_VERDICT);
  assert.match(report.verdict, /^\d+ wrong spots? for the named corpus$/);
  const duplicated = report.results.find(result => result.name === 'block duplicated');
  assert.ok(duplicated.wrongSpots > 0);
  assert.ok(duplicated.failures.some(failure => /^case "block duplicated": step "alpha-gamma pasted twice": wrong spot: exact at \{"line":2\} but expected ambiguous/.test(failure)), duplicated.failures.join('\n'));
  assert.ok(report.rates['reused-identity'].wrongSpots > 0);
});

test('a resolver reading Date.now() is caught by the purity trap, and globals are restored', () => {
  const now = Date.now;
  const random = Math.random;
  const timeout = globalThis.setTimeout;
  const fetchBefore = globalThis.fetch;
  const performanceNow = performance.now;
  const clockReader = { ...lineResolution, resolve: (anchor, snapshot, evaluated) => (Date.now(), lineResolution.resolve(anchor, snapshot, evaluated)) };
  const report = runAnchorConformance({ resolution: clockReader, cases: syntheticCorpus });
  assert.equal(report.passed, false);
  assert.ok(report.results.filter(result => result.group !== 'unknown-kind').every(result => !result.passed));
  assert.ok(failures(report).some(failure => /purity trap: resolve touched Date\.now/.test(failure)), failures(report).join('\n'));
  assert.ok(failures(report).some(failure => /resolve threw: purity trap: Date\.now is not allowed in resolve/.test(failure)));
  assert.equal(Date.now, now);
  assert.equal(Math.random, random);
  assert.equal(globalThis.setTimeout, timeout);
  assert.equal(globalThis.fetch, fetchBefore);
  assert.equal(performance.now, performanceNow);
  assert.equal(Object.hasOwn(performance, 'now'), false);
  assert.equal(typeof Date.now(), 'number');
});

test('a resolver that swallows the trap is still reported', () => {
  const sneaky = { ...lineResolution, resolve: (anchor, snapshot, evaluated) => { try { Math.random(); } catch {} return lineResolution.resolve(anchor, snapshot, evaluated); } };
  const report = runAnchorConformance({ resolution: sneaky, cases: syntheticCorpus.slice(0, 1) });
  assert.equal(report.passed, false);
  assert.match(failures(report)[0], /purity trap: resolve touched Math\.random/);
});

test('non-determinism, a wrong evaluated label, schema loss, an empty fallback and input mutation each fail', () => {
  const one = syntheticCorpus.slice(0, 1);
  const run = resolution => failures(runAnchorConformance({ resolution, cases: one })).join('\n');

  let calls = 0;
  assert.match(run({ ...lineResolution, resolve: (anchor, snapshot, evaluated) => (calls += 1) % 3 === 0 ? { kind: 'missing', evaluated } : lineResolution.resolve(anchor, snapshot, evaluated) }), /not deterministic over 3 calls/);
  assert.match(run({ ...lineResolution, resolve: (anchor, snapshot) => lineResolution.resolve(anchor, snapshot, 'something else') }), /reported evaluated "something else"/);
  assert.match(run({ ...lineResolution, schema: { ...lineResolution.schema, parse: value => ({ ...lineResolution.schema.parse(value), line: value.line + 1 }) } }), /schema round-trip changed the anchor/);
  assert.match(run({ ...lineResolution, fallback: () => ' ' }), /fallback is empty/);
  assert.match(run({ ...lineResolution, resolve: (anchor, snapshot, evaluated) => { snapshot.lines.push('x'); return lineResolution.resolve(anchor, snapshot, evaluated); } }), /resolve mutated its anchor or snapshot/);
});

test('an incomplete candidate set fails without a wrong spot; an extra candidate is a wrong spot', () => {
  const duplicated = syntheticCorpus.filter(item => item.name === 'block duplicated');
  const withCandidates = change => ({ ...lineResolution, resolve: (anchor, snapshot, evaluated) => {
    const placement = lineResolution.resolve(anchor, snapshot, evaluated);
    return placement.kind === 'ambiguous' ? { ...placement, candidates: change(placement.candidates) } : placement;
  } });

  const incomplete = runAnchorConformance({ resolution: withCandidates(candidates => candidates.slice(0, 1)), cases: duplicated });
  assert.equal(incomplete.passed, false);
  assert.equal(incomplete.wrongSpots, 0);
  assert.match(failures(incomplete).join('\n'), /incomplete candidate set/);

  const widened = runAnchorConformance({ resolution: withCandidates(candidates => [...candidates, { line: 0 }]), cases: duplicated });
  assert.equal(widened.wrongSpots, 1);
  assert.match(failures(widened).join('\n'), /wrong spot: candidate \{"line":0\} is outside the expected set/);
});
