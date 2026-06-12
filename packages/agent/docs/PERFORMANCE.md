# Performance

## Vercel Sandbox cold-start benchmark (2026-04-23)

> **Note:** The benchmark harness script has been removed from the repository. The results below are preserved for historical reference.

### Method

- Region: `iad1` (Vercel default for this team/project).
- Runtime: `python3.13`.
- Iterations: `10` per scenario.
- Readiness metric: elapsed time from `Sandbox.create(...)` start to first successful `runCommand('echo hi')`.
- Scenarios:
  - `source: empty`
  - `source: tarball` (small npm tarball URL)
  - `source: snapshot` (pre-baked snapshot)

Command used:

```bash
pnpm --filter @hachej/boring-agent run bench:vercel-cold-start -- \
  --iterations 10 \
  --runtime python3.13 \
  --snapshot-id <snapshot-id>
```

### Results (clean sample set)

The clean rollup uses `empty` + `tarball` from the full run and `snapshot`
from a dedicated snapshot-only rerun, because the first full run hit a Vercel
creation API throttle (`429`, 10-minute retry-after) on snapshot iteration 1.

#### Time to ready (`create` + first command)

| Scenario | p50 | p95 | p99 |
|---|---:|---:|---:|
| source: empty | 398 ms | 680 ms | 680 ms |
| source: tarball | 715 ms | 880 ms | 880 ms |
| source: snapshot | 1.81 s | 2.19 s | 2.19 s |

#### `Sandbox.create(...)` only

| Scenario | p50 | p95 | p99 |
|---|---:|---:|---:|
| source: empty | 216 ms | 499 ms | 499 ms |
| source: tarball | 542 ms | 696 ms | 696 ms |
| source: snapshot | 200 ms | 357 ms | 357 ms |

### Conclusion

- Snapshot creation itself is faster than tarball creation (`create` p50: 200 ms
  vs 542 ms), but end-to-end readiness is slower in this run (`ready` p50:
  1.81 s vs 715 ms), so the expected “snapshot is 10x faster” effect was not
  observed.
- Against the UX budget rule for cold start (`p95 > 3s => async polling UI`):
  measured cold-start p95 values are all `< 3s`, so a standard spinner is
  sufficient for nominal startup latency.
- Independent of cold-start latency, the platform creation rate limit can add
  multi-minute waits (`429` with `Retry-After: 600`), so the UI should still
  handle long provisioning states gracefully when API throttling occurs.

### Follow-up

- Re-run this benchmark on the recommended three windows (morning, afternoon,
  evening UTC) to check diurnal variance and confirm whether snapshot readiness
  remains slower than tarball readiness in steady state.
- If this pattern persists, revisit the M2 vercel-sandbox design assumption
  that snapshot boot is the fastest production path for first-command latency.
