# Boring v2 Model Card

Defaults, not a scheduler. The orchestrator may adapt to difficulty, availability,
taste, and cost. Cost is relative (`low`, `medium`, `high`, `scarce`), not pricing.

| Level / role | Default | Transport / billing | Cost | Use |
| --- | --- | --- | --- | --- |
| L0 worker—easy | GPT-5.5 | Pi / API | low | bounded implementation |
| L0 worker—medium | Tierra GT | Pi / API | medium | normal implementation |
| L0 worker—hard | Sol medium | Pi / API | high | difficult implementation |
| L0 visual-evidence operator | Qwen 3.6 on `mac` | Pi / local Mac provider | low | deterministic browser execution, asserted screenshots/video, logs, and HTML bundle packaging; never the visual critic or fix planner |
| L1 orchestrator/integrator | Sol medium | Pi / API | high | readiness, delegation, synthesis, handoff |
| L1 tier-1 reviewer | Gemini latest Pro, Grok latest, or Sol high | Pi / API | medium–high | fresh correctness, acceptance, proof, thermo |
| L2 tier-2 reviewer | Sol xHigh | Pi / API | high | plans; medium/hard, structural, risky, uncertain work |
| L3 tier-3 reviewer | Fable | Claude Code CLI / subscription | scarce | human-gated final falsification |

## Visual evidence operator

For registered UI scenarios, prefer Qwen 3.6 through the local `mac` provider as
the cheap evidence operator when available. It runs the deterministic scenario
and packages objective evidence; DOM assertions and hard gates, not the operator's
prose, establish whether a state passed. A vision-capable tier-1 reviewer grades
the resulting bundle independently. The operator never grades its own run, plans
fixes, edits product code, or approves a round.

Fallback when the Mac provider is unavailable: use another low-cost L0 worker
with the same no-critic/no-edit bounds and record the resolved model id in the
bundle handoff.

## Review ladder

```text
draft → tier 1 → integrate → tier 2 when required → integrate
      → tier 3 when enabled/approved → integrate → re-review → converge
```

- Pick one available tier-1 reviewer; rotate for independence. Add reviewers only
  for uncertainty/risk. Worker self-check is not independent review.
- Tier 2 is required for canonical plans and medium/hard, structural, risky, or
  tier-1-uncertain work; it also precedes tier 3.
- Code requires thermo: tier 1 for small changes; tier 2 for complex/structural/
  risky changes. Docs/config-only changes are exempt.

## Fable

Initial mode: `Fable: off | manual-gate` (default `off`). `manual-gate` requires
Inbox approval for every call and completed tier-2 dispositions. After approval,
run the prepared packet only:

```bash
claude --print --safe-mode --model fable --tools=Agent "$(cat "$packet")"
```

Fable receives no direct repository tools. The packet instructs it to use the
Agent tool with `model: sonnet` only for targeted, read-only context gathering.

A cheap subagent prepares the smallest self-contained packet preserving all
load-bearing context. Fable falsifies the work; it does not rewrite it or explore
the repository directly; it may delegate targeted missing-context retrieval to a
cheaper Sonnet subagent. Fable returns a verdict; another model integrates it,
then normal review repeats.

Minimal record:

```text
reviewer: tier-1 | tier-2 | tier-3
target: <revision>
verdict: clean | revise
findings: <summary or link>
```

Use `ask_user` for intent, risk, tier-3 spend, visual validation, and merge
approval; use a GitHub comment when unavailable.
