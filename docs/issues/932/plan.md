---
github: https://github.com/hachej/boring-ui/issues/932
issue: 932
state: ready-for-agent
updated: 2026-07-24
flag: not-needed
track: owner
---

# gh-932 persist the BSL Python worker across query batches

## Problem

`@hachej/boring-data-bridge` currently embeds two `python -c` programs in `plugins/data-bridge/src/server/index.ts`. `data.v1.query.run` starts Python once per query and `data.v1.query.batch` starts Python once per batch. The dashboard frontend already sends one batch for all dashboard queries, but every hydration still pays Python/Ibis/Pandas/BSL imports and `from_yaml()` model initialization. In the motivating dashboard, initialization dominates the roughly 0.7 seconds spent executing nine PostgreSQL aggregates.

The structured BSL HTTP `/query` API is not a substitute: Data Bridge intentionally supports flexible BSL/Ibis expression strings evaluated with `safe_eval`.

## Solution

Replace per-call Python spawning with one persistent Python worker owned by each configured Data Bridge server plugin instance. Communicate over a private versioned NDJSON protocol, keep the existing expression-string and WorkspaceBridge contracts, and cache loaded models in Python by normalized model/profile configuration.

Keep this implementation inside `plugins/data-bridge`; `plugins/bi-dashboard` already batches an entire dashboard through `DATA_BRIDGE_QUERY_BATCH_OP` and needs no production change.

### Intended layout

```text
plugins/data-bridge/
├── python/bsl_worker.py
├── src/server/bsl/pythonBslRuntime.ts
├── src/server/bsl/pythonBslRuntime.test.ts
├── src/server/index.ts
├── src/server/index.test.ts
├── package.json
└── README.md
```

Protocol types stay server-private; no `src/shared/**` change is required.

## Decisions

- **Ownership:** one worker per `createDataBridgeServerPlugin()` instance, not a process-global singleton. The plugin's bridge handlers and its `query_data` tool share that runtime.
- **Public contract:** retain `DataBridgeBslQuery`, `data.v1.query.run`, `data.v1.query.batch`, result formats, ordering, and per-item errors unchanged.
- **Execution contract:** retain BSL `safe_eval` with a fresh per-expression context containing all models plus `sm`, `ibis`, and `_`.
- **Batch path:** make a single BSL query use the same Python `queryBatch` method with one item; remove duplicate Python execution paths.
- **Transport:** compact newline-delimited JSON on stdout/stdin; stderr is logs only. Every message has request ID, method, and success/error envelope.
- **Methods:** implement only `ready` and `queryBatch`. Do not add MCP, HTTP, file watching, shutdown RPCs, warm RPCs, or a generic Python RPC framework.
- **Cache key:** resolved model path, profile, and resolved optional profile-file path. `.agents` models are immutable in the motivating deployment; cache reset is worker restart.
- **Scheduling:** one active batch at a time with a bounded Node queue. Add a worker pool only if later measurements prove contention.
- **Abort:** reject aborted requests without killing the shared warm worker. The worker may finish and emit an ignored stale response; later queued requests keep the cache hot.
- **Recovery:** unexpected exit rejects pending work with a stable worker error code; the next request performs one fresh start/readiness cycle. Do not retry semantic/query failures automatically.
- **Startup:** do **not** warm on startup. Start and warm lazily on the first BSL request (`data.v1.query.run` or batch) to keep startup fast. SQL-only configurations do not start Python.
- **Shutdown:** a plugin `routes` `onClose` hook requests shutdown, closes stdin, waits briefly, then terminates if needed.
- **Packaging:** ship `python/bsl_worker.py` in the npm package and resolve it from `import.meta.url`; never depend on process cwd.
- **Security:** do not expose the worker directly. Preserve WorkspaceBridge capabilities, limits, and timeout. As a focused hardening compatible with normal Ibis expressions, reject private/dunder attribute traversal before evaluation; do not claim `safe_eval` is a hostile-code sandbox.

## Flag / Abstraction

- Needed?: No feature flag. This is an internal implementation replacement behind unchanged bridge operations.
- Path: a small server-private `PythonBslRuntime` owns process/protocol/cache lifecycle; `index.ts` owns Data Bridge policy and result assembly.
- Rollback: revert the package change or pin the previous `@hachej/boring-data-bridge` release. No persisted data or dashboard migration is introduced.

## Test Seams

- Highest public seam: invoke `data.v1.query.run` and `data.v1.query.batch` through the WorkspaceBridge registry and assert unchanged ordered outputs/errors.
- Process seam: inject the child-process launcher into `PythonBslRuntime` tests and use a fake NDJSON worker stream; production code still defaults to `node:child_process.spawn`.
- Real integration seam: run the packaged worker with BSL installed and issue the same batch twice, observing one PID and one model load.
- Existing prior art: `executeBatch()` grouping and per-item result assembly in `plugins/data-bridge/src/server/index.ts`; Fastify `onClose` lifecycle hooks used by other server plugins.
- Avoid testing: BSL/Ibis internals, PostgreSQL aggregate correctness, or frontend rendering in unit tests.

## Acceptance

- [ ] Repeated BSL runs and batches through one plugin instance reuse one Python PID.
- [ ] Python imports BSL/Ibis once and caches `from_yaml()` models across batches by normalized configuration.
- [ ] Existing fluent expression strings and evaluation context work without dashboard changes.
- [ ] One-item run and multi-item batch use one Python `queryBatch` implementation.
- [ ] Batch order, IDs, row limits, result typing, Arrow conversion, and item-level error isolation remain compatible.
- [ ] NDJSON parsing handles split/coalesced chunks, malformed messages, stderr output, and write backpressure.
- [ ] Spawn failure, unexpected exit, active abort, and shutdown settle promises and do not leave an orphan worker.
- [ ] A subsequent query can start and warm a healthy replacement after worker failure.
- [ ] First BSL request performs worker/model warm-up lazily; SQL-only setup does not spawn Python.
- [ ] Private/dunder expression traversal is rejected without breaking representative dashboard expressions.
- [ ] The built npm tarball contains `python/bsl_worker.py` and resolves it independently of cwd.
- [ ] README documents persistence, lifecycle, Python executable configuration, and operational limitations.

## Proof

- Exact commands:
  - `pnpm --filter @hachej/boring-data-bridge test`
  - `pnpm --filter @hachej/boring-data-bridge typecheck`
  - `pnpm --filter @hachej/boring-data-bridge build`
  - `pnpm --filter @hachej/boring-data-bridge pack --pack-destination /tmp` (or the repository's equivalent package-dry-run command) and inspect the tarball file list
- Integration benchmark:
  1. Start a BSL-configured playground/container.
  2. Load the same multi-query dashboard twice.
  3. Record worker PID, model-load count, cold batch duration, and warm batch duration.
  4. Verify the first load may pay startup while the second load reuses PID/model cache and approaches database execution time rather than repeating interpreter/model startup.

- Failure proof: terminate the worker during an active test request; verify request fails deterministically and the next request succeeds through a replacement worker after lazy warm.
- Screenshot/demo: not required; this is server-runtime behavior. Preserve the existing dashboard as manual compatibility proof.

## Slice

### Slice: persistent BSL runtime

**Delivers:** packaged Python worker, private NDJSON client, model cache, plugin lifecycle integration, replacement of both inline Python paths, compatibility/failure tests, and documentation.

**Blocked by:** None.

**Proof:** scoped test/typecheck/build, package contents, real repeated-dashboard benchmark, and crash-recovery exercise above.

**Review budget:** inside; target under 1,500 added production-code lines. If robust lifecycle/protocol code exceeds that, defer pool/reload/extra observability rather than splitting the core persistence contract.

## Implementation Steps

1. Extract current expression evaluation/result normalization into `python/bsl_worker.py`; add model cache and a line-oriented `ready/queryBatch` loop.
2. Build `PythonBslRuntime` with direct `python -u <worker>` spawn, lazy first-use startup, framing, bounded serial queue, abort, restart, stderr, and close behavior.
3. Refactor `index.ts` around a plugin-scoped runtime shared by bridge handlers and the plugin-created agent tool; route single BSL execution through one-item batch.
4. Add plugin `routes` with `onClose` lifecycle hook for graceful worker shutdown (no startup warm).
5. Add protocol/lifecycle tests plus WorkspaceBridge compatibility tests; include representative fluent BSL expressions in real integration proof.
6. Package the worker asset, update README, run scoped proof, then validate cold/warm behavior in the downstream Healio Docker integration before release.

## Out of Scope

- Replacing expression strings with BSL's structured `/query` API.
- MCP transport.
- Multiple Python workers or parallel execution.
- Cross-Node-process worker sharing.
- Automatic model file watching/hot reload.
- Native CPython/Node bindings.
- Dashboard query deduplication or PostgreSQL tuning.
- Publishing a release or upgrading downstream applications in this issue without separate owner approval.

## Open Questions

None blocking. Initial decisions are: lazy first-call warm for configured BSL, best-effort keep-up on subsequent requests, one serial worker, and reload models only by worker restart.
