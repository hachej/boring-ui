// What the loop knows about a measured step, with no browser: how far a step is over its threshold, which steps a round says it aims at,
// and the trace text (numbers plus the layout-shift sources the browser reported) that Sol and the advisor read instead of guessing at a cause.
export const thresholds = s => ({ cls: 0.05, settledMs: 800, ...s.thresholds });
// Layout shift over its threshold, as a multiple of the threshold: 0.167 against 0.08 is 1.09. Layout shift is the one number that does not depend on the pace
// of the run (the same capture gives the same value), so it is the one a round is held to; settle time is only reported.
export const shiftExcess = (th, step) => step?.ok && step.cls > th.cls ? (step.cls - th.cls) / th.cls : 0;
export const settleExcess = (th, step) => step?.ok && step.settledMs > th.settledMs ? (step.settledMs - th.settledMs) / th.settledMs : 0;
export const round2 = n => Math.round(n * 100) / 100;
// Totals over a whole capture: the numbers the scoreboard and status.json show.
export function totals(s, result) {
  const th = thresholds(s); let shift = 0, settle = 0;
  for (const f of result?.flows ?? []) for (const st of f.steps) { if (st.gap) continue; shift += shiftExcess(th, st); settle += settleExcess(th, st); }
  return { shift: round2(shift), settle: round2(settle) };
}
export const run = (result, flow, viewport) => result?.flows?.find(f => f.id === flow && f.viewport === viewport);
// The steps most over their shift threshold in a capture, worst first: [{ flow, viewport, step, excess }].
export function worstSteps(s, result, n = 3) {
  const th = thresholds(s), all = [];
  for (const f of result?.flows ?? []) f.steps.forEach((st, i) => { const excess = shiftExcess(th, st); if (excess > 0) all.push({ flow: f.id, viewport: f.viewport, step: i + 1, excess: round2(excess) }); });
  return all.sort((a, b) => b.excess - a.excess).slice(0, n);
}
// `Measure: F14@390#4, F02@390#3` in a round's changes.md: the steps the worker says its change aims at (a bare F14@390 means every step of that flow).
export function declared(md) {
  const line = String(md ?? '').split('\n').find(l => /^\W*measure\b\W*:/i.test(l)) ?? '';
  return [...line.matchAll(/\b(F\d+)@(\w+)(?:#(\d+))?/g)].map(m => ({ flow: m[1], viewport: m[2], step: m[3] ? Number(m[3]) : null }));
}
// Shift excess of the declared steps in a capture (all steps of a flow when no step number is given).
export function declaredExcess(s, result, targets) {
  const th = thresholds(s); let sum = 0;
  for (const t of targets) { const steps = run(result, t.flow, t.viewport)?.steps ?? []; steps.forEach((st, i) => { if (!t.step || t.step === i + 1) sum += shiftExcess(th, st); }); }
  return round2(sum);
}
// Largest first: the area a source covers (before or after) times how far it moved.
const weight = s => Math.max(s.from.w * s.from.h, s.to.w * s.to.h) * (Math.abs(s.from.x - s.to.x) + Math.abs(s.from.y - s.to.y));
export function topSources(sources, n = 5) {
  const seen = new Map();
  for (const s of sources ?? []) { const k = `${s.el}|${JSON.stringify(s.from)}|${JSON.stringify(s.to)}`; if (!seen.has(k)) seen.set(k, s); }
  return [...seen.values()].sort((a, b) => weight(b) - weight(a)).slice(0, n);
}
const rect = r => `${r.w}x${r.h} at ${r.x},${r.y}`;
// The trace of a flow run (one flow at one viewport from a capture made with probe on): `only` limits it to some step numbers, `all` prints steps under their thresholds too.
export function traceText(s, flowRun, { only = null, all = false } = {}) {
  const th = thresholds(s), out = [`${s.target} ${flowRun.id}@${flowRun.viewport} (${flowRun.name}); thresholds: layout shift ${th.cls}, settle ${th.settledMs} ms`];
  flowRun.steps.forEach((st, i) => {
    const over = !st.ok || st.cls > th.cls || st.settledMs > th.settledMs;
    if (only ? !only.includes(i + 1) : !(all || over)) return;
    out.push(`step ${i + 1} "${st.say}": ${st.ok ? '' : 'DID NOT COMPLETE; '}layout shift ${st.cls}${st.cls > th.cls ? ' (over)' : ''}, settled ${st.settledMs ?? '-'} ms${st.settledMs > th.settledMs ? ' (over)' : ''}, first change ${st.firstChangeMs ?? '-'} ms, focus ends on ${st.focusAfter}`);
    if (st.shiftInPlaceIgnored) out.push(`    (${st.shiftInPlaceIgnored} more is not counted: rows inside the container the person acted on moved in place, which unfolding or folding content does by definition)`);
    if (st.shiftAfterInput) out.push(`    (${st.shiftAfterInput} of the ${st.cls} came within 500 ms of the person's own input: the browser's own layout-shift score leaves that part out)`);
    const src = topSources(st.shiftSources); for (const x of src) out.push(`    shifted: ${x.el}  ${rect(x.from)}  ->  ${rect(x.to)}`);
    if (st.cls > 0 && !src.length) out.push('    (the browser reported no source rectangles for this shift)');
  });
  if (out.length === 1) out.push('no step is over a threshold (pass --all to print every step)');
  return out.join('\n');
}
