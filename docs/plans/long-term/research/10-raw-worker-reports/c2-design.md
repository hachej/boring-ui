DESIGN INSPIRATION SWEEP over areas of Flue and eve we have NOT mined. Everything obvious has been
taken; go where a first pass does not look. The goal is design ideas we can steal, not a survey.

ALREADY HARVESTED — out of scope: hooks/render-per-turn; the filesystem convention; the accepted-work
durability contract; durable pause and approvals; data parts; extensions/override namespaces; the
persistence adapter contract; the sandbox adapter contract; two-surface observability; bounded tool
catalog and lexical search; prompt/context composition and compaction.

MINE THESE INSTEAD

1. **Error taxonomy and error UX.** Flue: `npx -y @flue/cli@2.0.3 docs read reference/errors` (from
   /home/ubuntu/projects/spike-flue-celld) — the `FlueError` hierarchy, stable type codes, the HTTP
   error envelope, settlement errors, error classification. eve: its error/diagnostics story
   (vercel.com/docs/eve, github.com/vercel/eve docs/) via curl -sL "https://r.jina.ai/<url>".
   What makes an error message actionable in each? How do they distinguish developer error, user error,
   provider error and internal error — and does the DISTINCTION reach the wire? Compare against ours:
   `git show origin/main:packages/agent/docs/ERROR_CODES.md` and
   `packages/agent/src/shared/error-codes.ts` in /home/ubuntu/projects/boring-ui-v2.
2. **Breaking changes and upgrades.** Flue shipped a 1.0-beta -> 2.0 migration guide
   (`docs read guide/migration`); eve is at 0.31.x with rapid iteration. How does each communicate,
   detect and automate a breaking change? Codemods? Runtime deprecation warnings with source
   attribution? Version-gated behaviour? Config schema versioning? **We have just decided breaking
   changes are allowed — so how a mature framework makes them survivable is directly load-bearing.**
3. **API vocabulary.** The nouns and verbs each chose, and why they read well: session vs conversation
   vs instance vs run; tool vs capability; skill vs instruction; admit vs dispatch vs submit; settle vs
   complete. This sounds cosmetic and is not — naming is the cheapest DX lever there is. Propose a
   vocabulary audit for our surface where a term is overloaded or where two terms mean one thing.
4. **Design philosophy in their own words.** `docs read guide/why-flue`; eve's positioning pages. What
   did they deliberately REFUSE to build, and why? A framework's refusals are more informative than its
   features. Which of their refusals should we adopt, and which do we already violate?
5. **Defaults and progressive disclosure as implemented.** Not the pitch — the mechanism. What does each
   do when a required decision is missing? Fail, prompt, guess, or defer? Find the actual code path.
6. **Anything genuinely surprising** that does not fit the categories above.

For every idea: mechanism, why it works, what it would cost us, and which of our ratified decisions
(D25-D31, static fleet, authored-data-not-code, default-deny grants) it would violate. Be blunt about
violations — an idea we cannot adopt is still worth knowing, but must be labelled.

OUTPUT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/c2-design-sweep.md
Ranked by value to us. End with "already better in ours" so we do not copy backwards, and "evaluated
and rejected" for anything you looked at and dismissed.
No preamble. 500-900 lines.
