# Challenge prompt template

> Inject the artefact under review and `state/exclusions.md`.

---

Adversarial review of {{ARTEFACT}}. Your job is to **falsify** it. A concrete failing scenario is worth
more than ten concerns; a confirmation is worth almost nothing.

Attack in this order:
1. **Arithmetic and quantities.** Do the numbers add up? Recompute them.
2. **Cited mechanisms.** Does the named API exist at the pinned version? Open it.
3. **Scope fairness.** Is a comparison matching like for like, or counting our surface against their subset?
4. **Unfalsifiable claims.** Anything that cannot be checked is a defect in the artefact.
5. **Overcorrection.** If this artefact is itself a correction, did it swing too far?

For each: verdict **SOUND / WEAK / WRONG / UNFALSIFIABLE**, the evidence, and the replacement wording.

If the artefact is broadly sound, say so plainly — but only after genuinely trying to break it. End with
what you would keep, in order, and what you would drop entirely.

Output to `runs/{{RUN}}/challenge.md` using REPORT-TEMPLATE.md. No preamble.
