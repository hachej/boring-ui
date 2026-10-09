import type { Anchor, AnchorResolution, Placement } from './contracts.js';

/** Anchor conformance kit (FEEDBACK.md, FEEDBACK-4). It drives one
 * `AnchorResolution` over a named corpus and returns structured results; it
 * imports no test runner, so any runner (or none) can assert on the output.
 * Its verdict is bounded to the corpus: "zero wrong spots for the named corpus".
 * The purity trap covers fetch, timers, Date.now, Math.random and
 * performance.now during `resolve`; it bounds the purity claim, it does not prove it.
 */

export type AnchorExpectation<Range> =
  | { readonly kind: 'exact' | 'moved'; readonly range: Range }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly Range[] }
  | { readonly kind: 'missing' | 'unsupported' };

export interface AnchorConformanceStep<Snapshot, Range> {
  readonly name: string;
  /** The full snapshot this step resolves against. */
  readonly snapshot: Snapshot;
  readonly evaluated: string;
  readonly expect: AnchorExpectation<Range>;
}

export interface AnchorConformanceCase<Snapshot, Range> {
  readonly name: string;
  /** Rates are reported per group. */
  readonly group: string;
  /** The anchor is data as stored; an unknown kind is kept, never parsed. */
  readonly capture: { readonly snapshot: Snapshot; readonly anchor: unknown };
  readonly steps: readonly AnchorConformanceStep<Snapshot, Range>[];
}

export interface AnchorConformanceInput<A extends Anchor, Snapshot, Range> {
  readonly resolution: AnchorResolution<A, Snapshot, Range>;
  readonly cases: readonly AnchorConformanceCase<Snapshot, Range>[];
}

export type PlacementKind = Placement<unknown>['kind'];

export interface AnchorStepResult<Range> {
  readonly name: string;
  readonly expect: AnchorExpectation<Range>;
  /** Absent when `resolve` threw or returned no placement. */
  readonly placement?: Placement<Range>;
  readonly passed: boolean;
  readonly wrongSpots: number;
  readonly failures: readonly string[];
}

export interface AnchorCaseResult<Range> {
  readonly name: string;
  readonly group: string;
  readonly passed: boolean;
  readonly wrongSpots: number;
  /** Case-level checks (schema round-trip, fallback) and every step failure, prefixed. */
  readonly failures: readonly string[];
  readonly steps: readonly AnchorStepResult<Range>[];
}

export interface AnchorGroupRates {
  readonly cases: number;
  readonly passedCases: number;
  readonly steps: number;
  readonly wrongSpots: number;
  readonly placements: Readonly<Record<PlacementKind | 'error', number>>;
  /** (exact + moved) / steps; reported, never thresholded. */
  readonly automatic: number;
}

export interface AnchorConformanceReport<Range> {
  readonly results: readonly AnchorCaseResult<Range>[];
  readonly wrongSpots: number;
  readonly rates: Readonly<Record<string, AnchorGroupRates>>;
  /** Every case passed every check. */
  readonly passed: boolean;
  readonly verdict: string;
}

export const ANCHOR_CONFORMANCE_VERDICT = 'zero wrong spots for the named corpus';
const DETERMINISM_CALLS = 3;

export function runAnchorConformance<A extends Anchor, Snapshot, Range>(
  input: AnchorConformanceInput<A, Snapshot, Range>,
): AnchorConformanceReport<Range> {
  const results = input.cases.map(item => runCase(input.resolution, item));
  const wrongSpots = results.reduce((sum, result) => sum + result.wrongSpots, 0);
  const passed = results.every(result => result.passed);
  return {
    results,
    wrongSpots,
    rates: groupRates(results),
    passed,
    verdict: wrongSpots === 0 ? ANCHOR_CONFORMANCE_VERDICT : `${wrongSpots} wrong spot${wrongSpots === 1 ? '' : 's'} for the named corpus`,
  };
}

function runCase<A extends Anchor, Snapshot, Range>(resolution: AnchorResolution<A, Snapshot, Range>, item: AnchorConformanceCase<Snapshot, Range>): AnchorCaseResult<Range> {
  const failures: string[] = [];
  const stored = item.capture.anchor;
  const kind = isRecord(stored) && typeof stored['kind'] === 'string' ? stored['kind'] : undefined;
  let anchor: A | undefined;
  if (kind === undefined) failures.push('anchor has no string kind');
  else if (kind === resolution.kind) anchor = checkSchema(resolution, stored, failures);
  else checkUnknown(stored, failures);

  const steps = item.steps.map(step => runStep(resolution, kind, anchor, step));
  for (const step of steps) for (const failure of step.failures) failures.push(`step "${step.name}": ${failure}`);
  const wrongSpots = steps.reduce((sum, step) => sum + step.wrongSpots, 0);
  return {
    name: item.name,
    group: item.group,
    passed: failures.length === 0,
    wrongSpots,
    failures: failures.map(failure => `case "${item.name}": ${failure}`),
    steps,
  };
}

/** Parse, serialize and parse again: the anchor must survive as plain data. */
function checkSchema<A extends Anchor, Snapshot, Range>(resolution: AnchorResolution<A, Snapshot, Range>, stored: unknown, failures: string[]): A | undefined {
  let anchor: A;
  try { anchor = resolution.schema.parse(stored); }
  catch (error) { failures.push(`schema rejected the captured anchor: ${message(error)}`); return undefined; }
  try {
    const again = resolution.schema.parse(JSON.parse(JSON.stringify(anchor)) as unknown);
    if (!deepEqual(again, anchor)) failures.push(`schema round-trip changed the anchor: ${show(anchor)} became ${show(again)}`);
  } catch (error) { failures.push(`schema round-trip failed: ${message(error)}`); }
  let fallback: unknown;
  try { fallback = resolution.fallback(anchor); }
  catch (error) { failures.push(`fallback threw: ${message(error)}`); }
  if (typeof fallback !== 'string' || fallback.trim() === '') failures.push(`fallback is empty: ${show(fallback)}`);
  return anchor;
}

/** An uninstalled kind is preserved as data and still carries its own fallback. */
function checkUnknown(stored: unknown, failures: string[]): void {
  let copy: unknown;
  try { copy = JSON.parse(JSON.stringify(stored)) as unknown; }
  catch (error) { failures.push(`unknown-kind anchor is not plain data: ${message(error)}`); return; }
  if (!deepEqual(copy, stored)) failures.push('unknown-kind anchor does not survive serialization');
  const fallback = isRecord(stored) ? stored['fallback'] : undefined;
  if (typeof fallback !== 'string' || fallback.trim() === '') failures.push(`unknown-kind anchor has an empty fallback: ${show(fallback)}`);
}

function runStep<A extends Anchor, Snapshot, Range>(
  resolution: AnchorResolution<A, Snapshot, Range>,
  kind: string | undefined,
  anchor: A | undefined,
  step: AnchorConformanceStep<Snapshot, Range>,
): AnchorStepResult<Range> {
  const failures: string[] = [];
  let placement: Placement<Range> | undefined;
  if (kind !== undefined && kind !== resolution.kind) {
    // Uninstalled kinds are placed as `unsupported` without calling another kind's resolver (FEEDBACK-3).
    placement = { kind: 'unsupported', evaluated: step.evaluated };
  } else if (anchor !== undefined) {
    placement = resolveChecked(resolution, anchor, step, failures);
  } else {
    failures.push('not resolved: the anchor did not parse');
  }

  let wrongSpots = 0;
  if (placement !== undefined) {
    if (placement.evaluated !== step.evaluated) failures.push(`reported evaluated ${show(placement.evaluated)}, expected ${show(step.evaluated)}`);
    const judged = judge(step.expect, placement);
    wrongSpots = judged.wrongSpots;
    failures.push(...judged.failures);
  }
  const base = { name: step.name, expect: step.expect, passed: failures.length === 0, wrongSpots, failures };
  return placement === undefined ? base : { ...base, placement };
}

/** Three trapped calls on cloned inputs: they must agree, leave inputs untouched and touch no trapped global. */
function resolveChecked<A extends Anchor, Snapshot, Range>(
  resolution: AnchorResolution<A, Snapshot, Range>,
  anchor: A,
  step: AnchorConformanceStep<Snapshot, Range>,
  failures: string[],
): Placement<Range> | undefined {
  const outputs: unknown[] = [];
  for (let call = 0; call < DETERMINISM_CALLS; call += 1) {
    const anchorCopy = structuredClone(anchor);
    const snapshotCopy = structuredClone(step.snapshot);
    const { value, touched, error } = trapped(() => resolution.resolve(anchorCopy, snapshotCopy, step.evaluated));
    if (touched.length) failures.push(`purity trap: resolve touched ${[...new Set(touched)].join(', ')}`);
    if (error !== undefined) { failures.push(`resolve threw: ${message(error)}`); return undefined; }
    if (!deepEqual(anchorCopy, anchor) || !deepEqual(snapshotCopy, step.snapshot)) failures.push('resolve mutated its anchor or snapshot');
    outputs.push(value);
  }
  const [first] = outputs;
  if (outputs.some(output => !deepEqual(output, first))) failures.push(`not deterministic over ${DETERMINISM_CALLS} calls: ${outputs.map(show).join(' / ')}`);
  if (!isPlacement(first)) { failures.push(`resolve returned no placement: ${show(first)}`); return undefined; }
  return first;
}

function judge<Range>(expect: AnchorExpectation<Range>, placement: Placement<Range>): { readonly wrongSpots: number; readonly failures: readonly string[] } {
  const failures: string[] = [];
  let wrongSpots = 0;
  const expectedSet: readonly Range[] = expect.kind === 'exact' || expect.kind === 'moved' ? [expect.range] : expect.kind === 'ambiguous' ? expect.candidates : [];
  const wanted = describe(expect);

  if (placement.kind === 'exact' || placement.kind === 'moved' || placement.kind === 'partial') {
    const sameRange = (expect.kind === 'exact' || expect.kind === 'moved') && deepEqual(placement.range, expect.range);
    if (!sameRange) {
      wrongSpots += 1;
      failures.push(`wrong spot: ${placement.kind} at ${show(placement.range)} but expected ${wanted}`);
    } else if (placement.kind !== expect.kind) {
      failures.push(`placed ${placement.kind} at the right range but expected ${wanted}`);
    }
    return { wrongSpots, failures };
  }
  if (placement.kind === 'ambiguous') {
    for (const candidate of placement.candidates) {
      if (!expectedSet.some(range => deepEqual(range, candidate))) {
        wrongSpots += 1;
        failures.push(`wrong spot: candidate ${show(candidate)} is outside the expected set ${show(expectedSet)}`);
      }
    }
    if (expect.kind !== 'ambiguous') failures.push(`ambiguous ${show(placement.candidates)} but expected ${wanted}`);
    else if (!sameSet(placement.candidates, expect.candidates)) failures.push(`incomplete candidate set ${show(placement.candidates)}, expected ${show(expect.candidates)}`);
    return { wrongSpots, failures };
  }
  if (placement.kind !== expect.kind) failures.push(`${placement.kind} but expected ${wanted}`);
  return { wrongSpots, failures };
}

function describe<Range>(expect: AnchorExpectation<Range>): string {
  if (expect.kind === 'exact' || expect.kind === 'moved') return `${expect.kind} at ${show(expect.range)}`;
  if (expect.kind === 'ambiguous') return `ambiguous ${show(expect.candidates)}`;
  return expect.kind;
}

function groupRates<Range>(results: readonly AnchorCaseResult<Range>[]): Readonly<Record<string, AnchorGroupRates>> {
  const groups = new Map<string, AnchorCaseResult<Range>[]>();
  for (const result of results) groups.set(result.group, [...(groups.get(result.group) ?? []), result]);
  const rates: Record<string, AnchorGroupRates> = {};
  for (const [group, members] of groups) {
    const placements: Record<PlacementKind | 'error', number> = { exact: 0, moved: 0, ambiguous: 0, partial: 0, missing: 0, unsupported: 0, error: 0 };
    let steps = 0;
    for (const member of members) for (const step of member.steps) { steps += 1; placements[step.placement?.kind ?? 'error'] += 1; }
    rates[group] = {
      cases: members.length,
      passedCases: members.filter(member => member.passed).length,
      steps,
      wrongSpots: members.reduce((sum, member) => sum + member.wrongSpots, 0),
      placements,
      automatic: steps === 0 ? 0 : (placements.exact + placements.moved) / steps,
    };
  }
  return rates;
}

// --- purity trap -----------------------------------------------------------

const TRAPS: readonly (readonly [owner: () => object | undefined, property: string, label: string])[] = [
  [() => globalThis, 'fetch', 'fetch'],
  [() => globalThis, 'setTimeout', 'setTimeout'],
  [() => globalThis, 'setInterval', 'setInterval'],
  [() => globalThis, 'setImmediate', 'setImmediate'],
  [() => globalThis, 'requestAnimationFrame', 'requestAnimationFrame'],
  [() => globalThis, 'requestIdleCallback', 'requestIdleCallback'],
  [() => Date, 'now', 'Date.now'],
  [() => Math, 'random', 'Math.random'],
  [() => (typeof performance === 'object' && performance !== null ? performance : undefined), 'now', 'performance.now'],
];

/** Runs `run` with each trapped global replaced by a recorder that throws.
 * Every replaced property is restored in `finally`, also when `run` throws.
 */
function trapped<T>(run: () => T): { readonly value?: T; readonly touched: readonly string[]; readonly error?: unknown } {
  const touched: string[] = [];
  const restore: (() => void)[] = [];
  try {
    for (const [ownerOf, property, label] of TRAPS) {
      const owner = ownerOf();
      if (owner === undefined || !(property in owner)) continue;
      const own = Object.getOwnPropertyDescriptor(owner, property);
      if (own !== undefined && !own.configurable) continue;
      Object.defineProperty(owner, property, {
        configurable: true, writable: true, enumerable: own?.enumerable ?? false,
        value: () => { touched.push(label); throw new Error(`purity trap: ${label} is not allowed in resolve`); },
      });
      restore.push(own === undefined ? () => { delete (owner as Record<string, unknown>)[property]; } : () => { Object.defineProperty(owner, property, own); });
    }
    return { value: run(), touched };
  } catch (error) {
    return { touched, error };
  } finally {
    for (const undo of restore.reverse()) undo();
  }
}

// --- plain-data helpers ----------------------------------------------------

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlacement(value: unknown): value is Placement<never> {
  if (!isRecord(value) || typeof value['evaluated'] !== 'string') return false;
  switch (value['kind']) {
    case 'exact': case 'moved': return 'range' in value;
    case 'partial': return 'range' in value && Array.isArray(value['missing']);
    case 'ambiguous': return Array.isArray(value['candidates']);
    case 'missing': case 'unsupported': return true;
    default: return false;
  }
}

function sameSet(actual: readonly unknown[], expected: readonly unknown[]): boolean {
  return actual.length === expected.length
    && actual.every(item => expected.some(other => deepEqual(item, other)))
    && expected.every(item => actual.some(other => deepEqual(item, other)));
}

/** Structural equality for plain data: primitives, arrays and plain objects. */
function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
}

function show(value: unknown): string {
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
