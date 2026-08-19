---
name: research-cycle
description: Run one competitive-research and self-audit cycle — harvest a competitor delta, ground it in our code, challenge it adversarially, spike what reasoning cannot settle, verify claims at call sites, and record findings. Use when running the scheduled research agent, or when asked to investigate a competing framework, audit a subsystem, or turn an idea into a grounded recommendation.
---

# Research cycle

One cycle produces **at most**: one competitor delta, one subsystem audit, two spikes. Anything larger
is a project, not a cycle.

## Non-negotiables

1. **Every claim carries `file:line` or a quoted source.** No citation, no row.
2. **Verification is not delegated.** A worker may report; only the orchestrator promotes a claim to
   verified, and only by tracing to a **call site** — never by reading the module that defines it.
3. **A clean negative is a good result.** Say so in every worker prompt.
4. **Demand a diff, not an estimate.** "This would break X" is not a finding until someone patches it.
5. **Mutation-test any "structural" claim.** Delete the constraint; if nothing fails, it is convention.
6. **Frame audits defensively.** "Verify whether the documented guarantee is implemented, and classify
   each control" — not "break it". Offensive framing gets blocked and deserves to be.
7. **Nothing acts on an unverified claim.** `reported` informs; only `verified` or `executed` triggers work.

## Phases

| # | Phase | Delegate? | Output |
|---|---|---|---|
| 0 | **Scope** | no | pick ONE competitor delta + ONE subsystem from `state/tracked.md` rotation |
| 1 | **Harvest** | yes, cheap | `harvest.md` — what changed since the tracked version |
| 2 | **Ground** | yes, cheap | `ground.md` — where our code differs, with `file:line` |
| 3 | **Challenge** | yes, strong | `challenge.md` — attack the harvest *and* our assumptions |
| 4 | **Spike** | yes, strong | `spikes/<topic>/` — only for questions reasoning cannot settle |
| 5 | **Verify** | **no** | promote claims by tracing call sites |
| 6 | **Record** | yes, cheap | update `register.md`, file/correct issues |

Every worker prompt MUST include the current `state/exclusions.md`. Without it, each run re-reports the
last one.

Findings are **markdown table rows** (REPORT-TEMPLATE.md), identical in reports, register and issues, so
they paste between them unchanged. No YAML, no frontmatter — the register is read by people.

## Phase 4 — when to spike

Spike only a question with a **falsifiable answer** that reading cannot produce:
- "does X preserve identity in the event stream?" → spike
- "is this API better?" → do not spike, that is taste

Every spike starts from `QUESTION.md` stating what would **refute** the hypothesis. A spike that cannot
be refuted is a demo.

## Phase 5 — verification protocol

For each `reported` claim, in order:
1. Find the definition. Does the mechanism exist?
2. **Find the call site.** Does anything invoke it? (`git grep` outside its own directory.)
3. Trace to the executing path. Is it reached at runtime, or only exported?
4. If the claim is "enforced", delete the enforcement mentally: what still stops the bad case?

A claim that survives 1–2 but fails 3 is the most common and most dangerous shape: **built, ratified,
never wired.** Record it as a defect, not a gap.

## Guardrails

- Workers cannot reach the credential vault or bind sockets. Scope spikes offline; the orchestrator runs
  any live half.
- Reap worker processes after their report is written.
- Require a number or a quote behind every superlative. "Very high saving" is not a finding.
- The cycle **fails** if any produced report is unread at Record time. Unconsumed output looks like
  coverage and is not.

## Files

```
prompts/     one prompt template per phase
REPORT-TEMPLATE.md · SPIKE-TEMPLATE.md   copy and fill in
state/       tracked.md · exclusions.md · register.md   ← persists across runs
```
