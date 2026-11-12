// `check`: no model. Fails when a flow step does not complete, a console error or failed request appears, a state cannot be reached,
// or a number crosses a threshold the scenario declares (scenario.thresholds, a step may override with its own `max`):
//   cls (layout shift per step)  settledMs  firstChangeMs  touchTarget (px, touch viewports, tapped targets)  overlaps  offscreen  truncated (counts)  focus (the step's `focus` target)  keepScroll
// `findings` is the same verdict as data (which step, a technical line, a plain-words line); `check` keeps the technical lines the command prints.
const seconds = ms => `${Math.round(ms / 100) / 10} s`;

export function findings(s, result) {
  const th = { cls: 0.05, settledMs: 800, touchTarget: 44, overlaps: Infinity, offscreen: Infinity, truncated: Infinity, ...s.thresholds };
  const out = [];
  const add = (where, text, plain, flow, index) => out.push({ flow, index, text: `${s.target} ${where}: ${text}`, plain });
  for (const message of result.stateFailures) add('state', `cannot be reached (${message})`, 'A still state of the component could not be reached.');
  for (const e of result.errors) add('console', e, 'The page logged an error.');
  const touch = new Set(s.viewports.filter(v => v.touch).map(v => v.name));
  for (const f of result.flows) {
    const at = `${f.id}@${f.viewport}`;
    for (const e of f.consoleErrors) add(at, `console error: ${e}`, 'The page logged an error during this flow.', f);
    for (const r of f.failedRequests) add(at, `failed request: ${r}`, 'A network request failed during this flow.', f);
    f.steps.forEach((st, i) => {
      const where = `${at} step ${i + 1} "${st.say}"`;
      const step = (text, plain) => add(where, text, plain, f, i);
      if (st.gap) return;
      if (!st.ok) return step(`did not complete${st.error ? ` (${st.error})` : ''}`, 'The step did not complete.');
      if (st.repeats) step('needed the gesture twice', 'The gesture had to be repeated before it worked.');
      if (st.cls > th.cls) step(`layout shift ${st.cls} > ${th.cls}`, `The layout jumps while it settles (shift ${st.cls}, expected at most ${th.cls}).`);
      if (st.settledMs !== null && st.settledMs > th.settledMs) step(`settled in ${st.settledMs} ms > ${th.settledMs}`, `It takes ${seconds(st.settledMs)} to settle (expected under ${seconds(th.settledMs)}).`);
      if (th.firstChangeMs && st.firstChangeMs > th.firstChangeMs) step(`first change after ${st.firstChangeMs} ms > ${th.firstChangeMs}`, `The first visible change comes after ${seconds(st.firstChangeMs)} (expected under ${seconds(th.firstChangeMs)}).`);
      if (touch.has(f.viewport) && st.target && Math.min(st.target.w, st.target.h) < th.touchTarget) step(`touch target ${st.target.w}x${st.target.h} < ${th.touchTarget} px`, `The touch target is ${st.target.w} x ${st.target.h} px (expected at least ${th.touchTarget}).`);
      if (st.overlaps.length > th.overlaps) step(`overlapping controls ${JSON.stringify(st.overlaps[0])}`, 'Two controls overlap.');
      if (st.offscreen.length > th.offscreen) step(`control outside the screen: ${st.offscreen[0]}`, 'A control sits outside the screen.');
      if (st.truncated.length > th.truncated) step(`text cut off: ${st.truncated[0]}`, 'Some text is cut off.');
      if (st.horizontalScroll) step('the page scrolls sideways', 'The page scrolls sideways.');
      if (st.expectFocus && !(st.focusAfter === st.expectFocus)) step(`focus is on "${st.focusAfter}", expected "${st.expectFocus}"`, `Keyboard focus is not where a person would expect it afterwards (on "${st.focusAfter}", expected "${st.expectFocus}").`);
      if (st.keepScroll) { const key = st.keepScroll, a = st.scrollBefore[key], b = st.scrollAfter[key]; if (a !== undefined && Math.abs(a - b) > 8) step(`scroll of ${key} moved from ${a} to ${b}`, 'The scroll position was lost.'); }
    });
  }
  return out;
}

export const check = (s, result) => findings(s, result).map(f => f.text);
