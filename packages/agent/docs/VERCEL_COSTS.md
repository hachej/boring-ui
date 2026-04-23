# Vercel Sandbox Cost Model

Date: 2026-04-23

## Inputs

### Pricing + limits (official)

Source: Vercel Sandbox pricing and limits (last updated March 14, 2026):
<https://vercel.com/docs/vercel-sandbox/pricing>

| Metric | Rate / Limit |
|---|---|
| Active CPU | `$0.128 / vCPU-hour` |
| Provisioned Memory | `$0.0212 / GB-hour` |
| Sandbox creations | `$0.60 / 1M` (`$0.0000006 / create`) |
| Data transfer | `$0.15 / GB` |
| Snapshot storage | `$0.08 / GB-month` |
| Default vCPU | `2` |
| Memory per vCPU | `2 GB` |
| Max runtime | Hobby `45 min`, Pro/Enterprise `5h` |
| vCPU allocation rate limit | Hobby `40 vCPU / 10 min`, Pro `200 / min`, Ent `400 / min` |

Snapshot defaults (official):
- <https://vercel.com/docs/vercel-sandbox/concepts/snapshots>
- Default snapshot expiration is `30 days` unless configured otherwise.

### Measured workload inputs (this repo)

- Cold-start benchmark (`96h`): [PERFORMANCE.md](./PERFORMANCE.md)
- FS + exec latency benchmark (`f4f`): [f4f-vercel-fs-latency.json](../bench-results/f4f-vercel-fs-latency.json)
- Measured snapshot sizes from benchmark project: ~`279 MB` each (`0.2606 GB`).

Observations:
- 96h: cold-start p95 is below `3s`, so we do not need a large warm pool to hide startup.
- f4f + 96h traces are I/O-heavy; CPU-active share is much lower than wall-clock. Model uses `30%` CPU-active as the baseline.

## Model

For one workspace/day:

```text
daily_cost =
  (active_cpu_vcpu_hours * 0.128) +
  (memory_gb * wall_clock_hours * 0.0212) +
  (creates_per_day * 0.0000006) +
  (snapshot_gb * snapshots_kept * 0.08 / 30)
```

Baseline assumptions used below:
- `2 vCPU`, `4 GB` memory.
- one active user session/day: `30 min` wall-clock, `30%` CPU-active.
- this gives `active_cpu_vcpu_hours = 2 * 0.5 * 0.3 = 0.3` vCPU-hours/day.
- `1` creation/day.
- snapshot retention `keep-last-2`.
- idle policy changes runtime billed for memory, but not active CPU time.

## Cost per Workspace per Day

Companion sheet: [vercel-cost-model-2026-04-23.csv](../bench-results/vercel-cost-model-2026-04-23.csv)

| Idle policy | Runtime billed/day | CPU $/day | Memory $/day | Snapshot $/day | Create $/day | Total $/day |
|---|---:|---:|---:|---:|---:|---:|
| Stop on session end | 0.5 h | 0.0384 | 0.0424 | 0.0014 | 0.0000006 | **0.0822** |
| Idle-stop after 60 min | 1.0 h | 0.0384 | 0.0848 | 0.0014 | 0.0000006 | **0.1246** |
| No explicit stop (5h timeout) | 5.0 h | 0.0384 | 0.4240 | 0.0014 | 0.0000006 | **0.4638** |
| Pinned 24h workspace | 24.0 h | 0.0384 | 2.0352 | 0.0014 | 0.0000006 | **2.0750** |

Implication:
- Memory wall-clock billing dominates cost. Idle lifetime policy matters far more than creation count.

## Snapshot Retention Trade-off

With measured snapshot size `0.2606 GB`:

| Retention | Storage/workspace/month |
|---|---:|
| Keep 1 | `$0.0209` |
| Keep 2 (current) | `$0.0417` |
| Keep 5 | `$0.1043` |
| Keep 10 | `$0.2085` |

Conclusion:
- **Keep-last-2 is still the right default.**
- Storage cost is tiny at small scale but scales linearly with workspace count.

## Idle Pool Sizing

If we keep a warm 2 vCPU / 4 GB sandbox running for 24h, per slot:
- Memory-only floor: `4 GB * 24h * 0.0212 = $2.0352/day`.
- At 1% CPU-active overhead, total is about `~$2.10/day` per warm slot.

Because 96h cold-start p95 is already `<3s`, default should be **no prewarmed idle pool**.

## Policy Recommendation

1. Keep `BORING_AGENT_SNAPSHOT_KEEP=2` (confirmed).
2. Stop sandbox proactively on session end; do not rely on timeout.
3. Add/keep idle-stop guardrail at `<= 60 min` idle.
4. Add stale-handle cleanup: force destroy after `24h` idle as a safety backstop if stop hooks are missed.
5. Keep idle pool size at `0` by default; only enable a tiny pool behind feature flag if product latency goals tighten.

This policy minimizes spend while keeping current UX targets achievable.
