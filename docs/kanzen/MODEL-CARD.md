# Boring v2 Model Card

Defaults, not a scheduler. The orchestrator may adapt to difficulty, availability,
taste, and cost. Cost is relative (`low`, `medium`, `high`, `scarce`), not pricing.

| Level / role | Default | Transport / billing | Cost | Use |
| --- | --- | --- | --- | --- |
| L0 worker—easy | GPT-5.6 Luna | Pi / API | low | bounded implementation, tests, and objective checks |
| L0 worker—medium | GPT-5.6 Terra | Pi / API | medium | normal implementation and local diagnosis |
| L0 worker—hard | Sol medium | Pi / API | high | difficult implementation |
| L0 visual-evidence operator | Qwen 3.6 on `mac` | Pi / local Mac provider | low | deterministic browser execution, asserted screenshots/video, logs, and HTML bundle packaging; never the visual critic or fix planner |
| L1 orchestrator/integrator | Sol medium | Pi / API | high | readiness, delegation, synthesis, handoff |
| L1 tier-1 reviewer | Gemini latest Pro, Grok latest, or Sol high | Pi / API | medium–high | fresh correctness, acceptance, proof, thermo |
| L2 tier-2 reviewer | Sol xHigh | Pi / API | high | plans; medium/hard, structural, risky, uncertain work |
| L3 tier-3 reviewer | Fable | Claude Code CLI / subscription | scarce | human-gated final falsification |

## GPT-5.6 worker routing

Route each stage separately:

- **Sol** resolves uncertainty, plans, adjudicates tradeoffs, and handles hard or
  consequential implementation.
- **Terra** handles normal implementation that still needs diagnosis or local
  design judgment.
- **Luna** implements bounded, reversible work packets, writes/runs tests, and
  checks objective acceptance criteria.

A Luna packet names one outcome, relevant context, invariants, forbidden changes,
proof commands, and stop conditions for unapproved product, API, architecture,
security, or scope choices. Escalate when requirements are ambiguous, tests do
not localize failure, cross-layer tradeoffs appear, or one focused retry fails.
Worker self-check is not independent review; consequential work still follows the
review ladder.

### Price snapshot

Verified 2026-08-04. Prices are base API rates per million text tokens.

| Model | Input | Cached input | Output | Announced reduction |
| --- | ---: | ---: | ---: | ---: |
| GPT-5.6 Luna | $0.20 | $0.02 | $1.20 | 80% |
| GPT-5.6 Terra | $2.00 | $0.20 | $12.00 | 20% |

Prompts over 272K input tokens are billed at 2× input and 1.5× output for the
full request; cache writes are billed at 1.25× uncached input. API pricing is not
subscription quota accounting. Treat price as a routing input, not evidence of a
capability change. Track first-pass success, review findings, retries, elapsed
time, and total cost per accepted change before changing roles.

Refresh this snapshot through the
[documentation refresh task list](documentation-refresh-tasks.md). Official
sources: [price-performance announcement](https://openai.com/index/advancing-the-price-performance-frontier-with-gpt-5-6/),
[Luna model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna),
and [Terra model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-terra).

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
