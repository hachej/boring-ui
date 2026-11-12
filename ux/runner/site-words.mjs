// Facts in plain words, computed from one step's metrics. No judgement, no model.
const s1 = ms => `${Math.round(ms / 100) / 10} s`;
const after = ms => (ms < 1000 ? `${ms} ms` : s1(ms));

export function stepFacts(step, touch = false) {
  if (step.gap) return [`<span class="gap">Not in the kit yet:</span> ${step.gap}`];
  if (!step.ok) return ['Did not complete'];
  const facts = [];
  if (typeof step.firstChangeMs === 'number') facts.push(`First visible change after ${after(step.firstChangeMs)}`);
  const moved = Object.entries(step.moved ?? {}).filter(([, m]) => m && (m.dx > 1 || m.dy > 1 || m.dh > 1));
  const watched = Object.values(step.moved ?? {}).some(Boolean);
  if (moved.length) for (const [name, m] of moved) facts.push(`The ${name} moves ${Math.max(m.dx, m.dy, m.dh)} px`);
  else if (watched) facts.push('Nothing moves during the action');
  if (typeof step.settledMs === 'number') facts.push(`Settled in ${s1(step.settledMs)}`);
  if (!step.cls) facts.push('No layout shift');
  else facts.push(`Layout shift ${step.cls}`);
  if (step.expectFocus) facts.push(step.focusAfter === step.expectFocus ? `Focus lands on "${step.expectFocus}"` : `Focus is on "${step.focusAfter}", not "${step.expectFocus}"`);
  if (step.target && step.target.w && touch) facts.push(`Touch target ${step.target.w} x ${step.target.h} px`);
  return facts;
}
