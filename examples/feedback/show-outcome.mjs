// The page side of the chat card's element lines (FEEDBACK-7; hover highlights, click may ask the person to choose): read the report with the person's own access, resolve its anchor against the
// live page with `showAnchor`, and report to the card only what really happened. `applied` only after a reveal; an ambiguous
// placement waits for the person to choose a numbered candidate; a removed element is `stale` with "Missing" in its reason (the
// card's outcome kinds are applied, stale, unavailable and denied); a kind this page cannot place is `unavailable`. Each outcome also
// carries a `detail` (and `matches` for candidates) so the card can say it in a few words; `reason` stays the full sentence. Plain JS so it
// runs in the browser bundle and, with HappyDOM, in Node tests.

/** A `showAnchor` outcome as the card's outcome. `choose(candidates)` asks the person and resolves to a number or undefined. */
export async function cardOutcomeOf(outcome, { choose }) {
  switch (outcome.kind) {
    case 'revealed':
      return outcome.placement === 'chosen' ? { kind: 'applied', reason: 'You chose this candidate.', detail: 'chosen' }
        : outcome.placement === 'moved' ? { kind: 'applied', reason: 'Found by its identity; it moved since the report.', detail: 'moved' }
          : { kind: 'applied', reason: 'Found where the report points.', detail: 'found' };
    case 'choose': {
      const number = await choose(outcome.candidates);
      if (number === undefined) return { kind: 'unavailable', reason: 'No candidate was chosen, so nothing was shown.', detail: 'not-chosen' };
      return cardOutcomeOf(outcome.choose(number), { choose });
    }
    case 'stale': return { kind: 'stale', reason: outcome.reason };
    case 'missing': return { kind: 'stale', reason: `Missing: ${outcome.reason}`, detail: 'missing' };
    case 'unsupported': return { kind: 'unavailable', reason: `Unsupported here: ${outcome.reason}` };
    default: return { kind: 'unavailable', reason: 'The page reported no recognised result.' };
  }
}

/**
 * The card's `onShowFeedback` for a page (`intent` is 'hover' or 'click'; a hover never opens the chooser): `read(id)` is the host's authorized read (`{ kind: 'available', report }`, `denied`,
 * `missing`...), `show(anchor, note)` resolves and reveals in the live page (`showAnchor`), `choose` asks the person.
 */
export function pageShow({ read, show, choose }) {
  return async ({ id, anchor, note, intent = 'click' }) => {
    let result;
    try { result = await read(id); } catch { return { kind: 'unavailable', reason: 'The feedback could not be read.' }; }
    if (result?.kind === 'denied') return { kind: 'denied', reason: result.reason || 'You may not read this feedback.' };
    if (result?.kind !== 'available') return { kind: 'unavailable', reason: result?.kind === 'missing' ? 'This feedback no longer exists.' : result?.reason || 'The feedback could not be read.' };
    const target = result.report.anchors[anchor];
    if (!target) return { kind: 'unavailable', reason: `The report has no anchor ${anchor}.` };
    const outcome = await show(target, note);
    // A hover only highlights: an ambiguous placement is stated (its candidates are numbered on the page), never chosen for the person.
    if (intent === 'hover' && outcome.kind === 'choose') {
      const matches = outcome.candidates.length;
      return { kind: 'unavailable', detail: 'choose', matches, reason: matches === 1 ? 'One place on this page may be it; click to confirm.' : `It matches ${matches} places on this page; click to choose one.` };
    }
    return cardOutcomeOf(outcome, { choose });
  };
}
