# Feedback laws

These laws are owned by `@hachej/boring-feedback` and defined only here. [docs/LAWS.md](../../docs/LAWS.md) indexes them; [VERIFY.json](../../VERIFY.json) records their structural checks and their runtime proofs, which stay pending until the work package named in each reason passes. They add only feedback-specific obligations: lifecycle, authority and publication remain BORING-PI-2, 4, 5 and 6 (root [INVARIANTS.md](../../INVARIANTS.md)) and EXPERIENCE-1. The design is in [FEEDBACK.md](../../docs/architecture/FEEDBACK.md).

## FEEDBACK-1 — one format, conditional writes

One format, conditional writes. Every producer serializes through `./format`. A report is one file and there is no index: every stored change is one conditional single-file publication of that report (creation expects it absent, resolution expects the revision read), admitted with a stable operation identity; an uncertain outcome is `unknown`. Listing reads the files that are there, so it promises no snapshot across reports. Native working tools cannot change the root, or the host has explicitly declared it unprotected and every surface says so.

## FEEDBACK-2 — usable without an agent or a viewer

Usable without an agent or a viewer. The report is self-contained, Copy works with no storage and no agent, and every anchor has a non-empty fallback.

## FEEDBACK-3 — anchors and observations are versioned data

Anchors and observations are versioned data. Unknown or uninstalled kinds are preserved through every store operation and placed as `unsupported`.

## FEEDBACK-4 — placement is honest

Placement is honest. `resolve` is a function of the anchor and one explicit snapshot, and reports what it evaluated. Only unique matches are `exact` or `moved`. Nothing uncertain is revealed without a person's choice. For each named corpus, the wrong-spot count is zero.

## FEEDBACK-5 — the parts are independent

The parts are independent. Annotation works without storage or an agent; the tool works without a browser; no existing package imports feedback.

## FEEDBACK-6 — observed state and late results

Observed state and late results. A report records what was observed (kind, subject or locator, base when it has one, snapshot form, digest, privacy policy). Asynchronous completions are bound to an id and fenced against resolution and deletion.

## FEEDBACK-7 — no new authority, untrusted content

No new authority, untrusted content. Feedback grants nothing. Every captured field is escaped data after the preface. Authorship comes from the host. `show` never claims a reveal it did not perform.

## FEEDBACK-8 — private by default

Private by default. Everything that leaves the page passes the allowlist policy in the browser, and every widening is recorded. The host authorizes capture, reading and processing. Caps are explicit. Deletion is a file operation of the host, outside the store, and is honest about what it cannot reach.
