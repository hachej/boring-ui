# Boring v2 Model Card

Priority-ordered tiers, not a scheduler. Seats bind to tiers, never model IDs
(`.agents/factory/policy.yaml` references tiers only). Within a tier, pick the
first available model — quota is an availability gate, not an optimizer. A
rate limit falls to the next model in the same tier; a whole tier exhausted
defers shippable work, it never silently downgrades. A quality miss escalates
a tier.

| Tier | Models | Role |
| --- | --- | --- |
| T1 frontier | Fable; Sol xhigh | Fable holds AgentHost/pi-native seats (Concierge, Steward) and class-B/thermo review. Sol xhigh is a codex-exec-only cross-model adversarial pass on plans and class-B PRs (shared 5h OpenAI window, cap 2 tracks) — it cannot hold a seat. |
| T2 strong | Opus 4.8; Sol medium | Opus is the default Reviewer seat and works hard-tagged beads. Sol medium runs lighter cross-checks. |
| T3 workhorse | Terra; Sonnet 4.6 | Terra (codex, cannot hold a pi session) does cheap bulk/mechanical delegated work. Sonnet 4.6 is the pi-native Worker default and runs triage sweeps. |
| T4 mechanical | Luna; Haiku | Luna (codex) is the cheapest pass. Haiku runs where a pi-native automation runtime is required — Beadle tick, reconciliation, notifications. |

## Review ladder

```text
draft → T2/T3 self-check → T1 cross-model pass (plans, class-B) → T1 (Fable) falsification → integrate
```

- Worker self-check is not independent review; consequential work still climbs the ladder.
- Sol xhigh (T1, codex-exec) is required for canonical plans and for medium/hard,
  structural, risky, or contested work — it precedes Fable.
- Fable (T1) is the human-gated final falsification: `manual-gate` requires
  Inbox approval per call. Fable gets no direct repo tools; it delegates
  read-only context gathering to a Sonnet subagent and returns a verdict —
  it does not rewrite the work. Another model integrates the verdict, then
  review repeats.
- Code requires thermo: T2/T3 for small changes, T1 for complex/structural/risky.
  Docs/config-only changes are exempt.

Minimal record:

```text
reviewer: <model/tier>
target: <revision>
verdict: clean | revise
findings: <summary or link>
```

## Visual evidence operator

Prefer Qwen 3.6 on the local `mac` provider as the cheap evidence operator: it
runs the deterministic scenario and packages objective evidence (DOM
assertions, screenshots, logs) — it never grades its own run, plans fixes, or
edits product code. A vision-capable T2 reviewer grades the bundle
independently. Fallback: another T4 worker, same no-critic/no-edit bounds,
resolved model id recorded in the handoff.

## Price snapshot

Tracked via the [documentation refresh task list](documentation-refresh-tasks.md)
(`model-pricing`, weekly). Price is a routing input, not evidence of a
capability change — track first-pass success, review findings, retries, and
cost per accepted change before changing a model's tier.

Use `ask_user` for intent, risk, T1 spend, visual validation, and merge
approval; use a GitHub comment when unavailable.
