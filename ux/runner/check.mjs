// `check`: no model. Fails when a flow step does not complete, a console error or failed request appears, a state cannot be reached,
// or a number crosses a threshold the scenario declares (scenario.thresholds, a step may override with its own `max`):
//   cls (layout shift per step)  settledMs  firstChangeMs  touchTarget (px, touch viewports, tapped targets)  overlaps  offscreen  truncated (counts)  focus (the step's `focus` target)  keepScroll
export function check(s, result) {
  const th = { cls: 0.05, settledMs: 800, touchTarget: 44, overlaps: Infinity, offscreen: Infinity, truncated: Infinity, ...s.thresholds };
  const problems = [];
  const add = (where, text) => problems.push(`${s.target} ${where}: ${text}`);
  for (const message of result.stateFailures) add('state', `cannot be reached (${message})`);
  for (const e of result.errors) add('console', e);
  const touch = new Set(s.viewports.filter(v => v.touch).map(v => v.name));
  for (const f of result.flows) {
    const at = `${f.id}@${f.viewport}`;
    for (const e of f.consoleErrors) add(at, `console error: ${e}`);
    for (const r of f.failedRequests) add(at, `failed request: ${r}`);
    f.steps.forEach((st, i) => {
      const where = `${at} step ${i + 1} "${st.say}"`;
      if (st.gap) return;
      if (!st.ok) return add(where, `did not complete${st.error ? ` (${st.error})` : ''}`);
      if (st.repeats) add(where, 'needed the gesture twice');
      if (st.cls > th.cls) add(where, `layout shift ${st.cls} > ${th.cls}`);
      if (st.settledMs !== null && st.settledMs > th.settledMs) add(where, `settled in ${st.settledMs} ms > ${th.settledMs}`);
      if (th.firstChangeMs && st.firstChangeMs > th.firstChangeMs) add(where, `first change after ${st.firstChangeMs} ms > ${th.firstChangeMs}`);
      if (touch.has(f.viewport) && st.target && Math.min(st.target.w, st.target.h) < th.touchTarget) add(where, `touch target ${st.target.w}x${st.target.h} < ${th.touchTarget} px`);
      if (st.overlaps.length > th.overlaps) add(where, `overlapping controls ${JSON.stringify(st.overlaps[0])}`);
      if (st.offscreen.length > th.offscreen) add(where, `control outside the screen: ${st.offscreen[0]}`);
      if (st.truncated.length > th.truncated) add(where, `text cut off: ${st.truncated[0]}`);
      if (st.horizontalScroll) add(where, 'the page scrolls sideways');
      if (st.expectFocus && !(st.focusAfter === st.expectFocus)) add(where, `focus is on "${st.focusAfter}", expected "${st.expectFocus}"`);
      if (st.keepScroll) { const key = st.keepScroll, a = st.scrollBefore[key], b = st.scrollAfter[key]; if (a !== undefined && Math.abs(a - b) > 8) add(where, `scroll of ${key} moved from ${a} to ${b}`); }
    });
  }
  return problems;
}
