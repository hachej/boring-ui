# Performance Benchmarks

## Vercel Sandbox FS Latency (boring-ui-v2-f4f)

Recorded: 2026-04-23  
> **Note:** The benchmark harness script has been removed from the repository. The results below are preserved for historical reference.

### Methodology

- Fixture:
  - 100 files under `bench-latency/tree/**` (for `find`)
  - 50 files under `bench-latency/grep/**` (for `grep`)
  - 1 hot file `bench-latency/read-target.txt` (for `readFile`/`stat`)
- Iterations:
  - FS ops (`mkdir`, `writeFile`, `readFile`, `stat`): 50 each
  - Command loops (`find`, `grep`): 20 each
- Comparison groups:
  - `vercel-fs`: `createVercelSandboxWorkspace` over live `@vercel/sandbox`
  - `local-node`: `createNodeWorkspace` on host filesystem
  - `vercel-exec`: `createVercelSandboxExec(...).exec(...)`
  - `local-bwrap exec`: `createBwrapSandbox(...).exec(...)`



### Results (ms)

| Benchmark | p50 | p95 | p99 | mean |
|---|---:|---:|---:|---:|
| local-node mkdir | 0.6 | 1.2 | 1.9 | 0.7 |
| vercel-fs mkdir | 145.7 | 229.2 | 329.5 | 158.2 |
| local-node writeFile | 0.8 | 1.6 | 3.1 | 0.9 |
| vercel-fs writeFile | 181.9 | 318.0 | 760.8 | 208.2 |
| local-node readFile | 0.7 | 1.7 | 2.9 | 0.9 |
| vercel-fs readFile | 131.2 | 316.2 | 650.5 | 157.3 |
| local-node stat | 0.3 | 0.4 | 0.6 | 0.3 |
| vercel-fs stat | 298.8 | 513.9 | 677.6 | 342.4 |
| local-bwrap exec find(100 files) | 26.5 | 31.2 | 34.9 | 27.3 |
| vercel-exec find(100 files) | 297.4 | 450.4 | 463.6 | 315.6 |
| local-bwrap exec grep(50 files) | 26.2 | 30.5 | 31.0 | 27.0 |
| vercel-exec grep(50 files) | 292.4 | 526.2 | 551.2 | 327.6 |

### p50 Slowdown Ratios

| Operation | Comparison | Slowdown |
|---|---|---:|
| mkdir | `vercel-fs` vs `local-node` | 226.5x |
| writeFile | `vercel-fs` vs `local-node` | 232.4x |
| readFile | `vercel-fs` vs `local-node` | 178.7x |
| stat | `vercel-fs` vs `local-node` | 1063.5x |
| `find` (100 files) | `vercel-exec` vs `local-bwrap exec` | 11.2x |
| `grep` (50 files) | `vercel-exec` vs `local-bwrap exec` | 11.2x |

## Conclusion

Vercel sandbox per-call filesystem operations are significantly slower than local operations, and command loops (`find`, `grep`) are >2x slower (actually ~11x at p50).  
For agent behavior, this makes tight per-file loops high-cost in remote mode and validates batching/caching strategies.
In `vercel-sandbox` mode, prefer the `find_files` catalog tool (backed by `FileSearch`) over `bash` + `find` loops for file enumeration.

## Mitigations Opened

Because measured slowdowns are >2x, follow-up mitigation beads were created:

- `boring-ui-v2-jru.1` — Add `find_files` tool over `FileSearch` (avoid shell `find` loops)
- `boring-ui-v2-jru.2` — Add `grep_files` batched tool (single call for multi-file search)
- `boring-ui-v2-jru.3` — Add short-lived `readdir`/`stat` cache in vercel workspace adapter
