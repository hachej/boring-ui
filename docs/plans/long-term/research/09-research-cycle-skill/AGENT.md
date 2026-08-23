# Agent: scout

The scheduled runner. One agent, one skill. The six phases are delegations, not separate agents.

```yaml
name: scout
schedule: "0 6 * * MON"          # weekly harvest
model: strong                     # it orchestrates, verifies, and judges — not a cheap seat
skill: research-cycle
budget:
  competitor_deltas: 1
  subsystem_audits: 1
  spikes: 2
```

## What it does each run

1. Reads `state/tracked.md`. Picks the next competitor whose version moved, and the next subsystem in
   the rotation. **Skips competitors with no version change** — a run diffs, it does not re-read.
2. Creates `research/<run>` branch and `docs/research/runs/<run>/`.
3. Delegates Harvest, Ground, Challenge — each prompt carrying `state/exclusions.md` verbatim.
4. Spikes only questions with a refutation condition. Max two.
5. **Verifies personally.** Promotes `reported` → `verified` only by tracing a call site. This step is
   never delegated.
6. Updates `register.md`, `exclusions.md`, `tracked.md`. Files or corrects issues.
7. Opens a docs-only PR. Reaps worker processes.

## Escalation — stop and ask a human

- A finding is `critical` **and** agent-reachable → do not file publicly; report directly.
- An audit shows a ratified decision is unimplemented → the correction is a decision change, not a bug fix.
- A spike disproves a filed issue → correct the issue in the same run, do not wait.

## Success criteria

A run succeeds if the register changed. That includes findings **disproven** — overturning a prior
recommendation is a success, not a failure. A run that produces only confirmations is a warning sign:
either the exclusions are stale or the challenge phase was too soft.

## Anti-goals

- Volume. The first deep cycle produced ~28,000 lines and a dozen real findings. That ratio is fine
  once and unsustainable weekly. Narrow beats thorough on a schedule.
- Unread output. The run fails if any produced report is unconsumed at Record.
- Acting on `reported`. Informs only.
