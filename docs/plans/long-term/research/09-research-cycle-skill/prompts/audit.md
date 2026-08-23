# Subsystem audit prompt template (defensive framing — do not reword as an attack)

> Substitute {{SUBSYSTEM}}, {{FILES}}, {{GUARANTEES}}. Inject `state/exclusions.md`.

---

Defensive verification audit of our own **{{SUBSYSTEM}}**. This is a first-party review of a repository
we own, checking whether documented guarantees are implemented. The deliverable is a **classification**,
not an exploit.

{{EXCLUSIONS}}

Documented guarantees to verify: {{GUARANTEES}}
Code: {{FILES}} — read from `origin/main` via `git show origin/main:<path>`.

For each guarantee, establish with `file:line`:
1. Does the mechanism exist?
2. **Does anything call it?** (`git grep` outside its own directory.)
3. Is it reached on the executing path, or only exported?
4. If the enforcement code were removed, what would still prevent the bad case?

Classify each control: **STRUCTURAL** (the bad case cannot be expressed) / **ENFORCED-BY-CODE** (a check
runs) / **CONVENTION-ONLY** (nothing runs; the guarantee is documentation).

Report where a guarantee genuinely holds as clearly as where it does not — a verified control is as
valuable as a gap. Where docs and code disagree, quote both.

Record findings as table rows (REPORT-TEMPLATE.md), `conf: reported`. Output to
`runs/{{RUN}}/ground.md`. No preamble.
