# Boring v2 Model Card

Defaults, not a scheduler. The orchestrator may adapt to difficulty, availability,
taste, and cost. Cost is relative (`low`, `medium`, `high`, `scarce`), not pricing.

| Level / role | Default | Transport / billing | Cost | Use |
| --- | --- | --- | --- | --- |
| L0 worker—easy | GPT-5.5 | Pi / API | low | bounded implementation |
| L0 worker—medium | Tierra GT | Pi / API | medium | normal implementation |
| L0 worker—hard | Sol medium | Pi / API | high | difficult implementation |
| L1 orchestrator/integrator | Sol medium | Pi / API | high | readiness, delegation, synthesis, handoff |
| L1 tier-1 reviewer | Gemini latest Pro, Grok latest, or Sol high | Pi / API | medium–high | fresh correctness, acceptance, proof, thermo |
| L2 tier-2 reviewer | Sol xHigh | Pi / API | high | plans; medium/hard, structural, risky, uncertain work |
| L3 tier-3 reviewer | Fable | Claude Code CLI / subscription | scarce | human-gated final falsification |

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
claude --print --safe-mode --model fable --tools Agent \
  --agents "$sonnet_context_agent" "$(cat "$packet")"
```

`$sonnet_context_agent` defines one read-only Sonnet agent for targeted context
gathering; Fable receives no direct repository tools.

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
