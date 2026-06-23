# Subagent: Orchestrator‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

Coordinates a Squad or Swarm docs run. Owns the phase graph, spawns workers, tracks artifacts, surfaces blockers.

## Role

- Reads `workspace/partition.json` and computes the phase task graph in memory.
- Spawns per-section subagents at each phase gate.
- Tracks completion via `workspace/orchestrator-log.jsonl` and phase artifacts.
- Surfaces contradictions, missing inputs, or rate-limit stalls to the main agent.

## Inputs

- `workspace/partition.json` — section list with dependencies.
- `workspace/phase_metrics.json` — current phase-gate scores.​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
- Mode variant (`quick` | `standard` | `comprehensive`) from Phase 0.

## Outputs

- `workspace/orchestrator-log.jsonl` — one line per spawn/completion/retry event.
- `workspace/orchestrator-status.md` — human-readable status snapshot (refreshed every 30s).

## Prompt template

```
You are the ORCHESTRATOR for a multi-agent documentation run.

Partition: <<workspace/partition.json contents>>
Mode: <<mode>>
Tier: <<solo|pair|squad|swarm>>​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌
Phase: <<current phase, 1..10>>

Your job for this phase:
1. Compute which tasks are `ready` (blockedBy cleared).
2. Spawn up to `max_parallel = <<4|8|12>>` subagents for ready tasks.
3. Record spawn in `workspace/orchestrator-log.jsonl`.
4. When a subagent completes, mark the task closed; recompute ready set.
5. Abort the phase if:​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
   - A task fails 3 times (record in failures.md, escalate to user).
   - The total phase token budget is exceeded.
   - Any task reports a contradiction with another section.

Never write to `content/**` directly — that's the drafter's job.
Never skip validation — the Phase gate in QUALITY-METRICS.md is non-negotiable.
```

## Composes with

- [ORCHESTRATION.md](../references/ORCHESTRATION.md) — the orchestration model.
- [subagents/triangulator.md](triangulator.md) — spawned for Phase 4 polish.
- [subagents/fresh-eyes.md](fresh-eyes.md) — spawned for Phase 7.
