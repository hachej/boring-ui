# [Epic Closure] Plan, visually

## Structure — where closure lives

```text
apps/factory-playground/src/server/
├── delegatePlugin.ts        # factory_status + Orchestrator close_epic
├── supervisionPlugin.ts     # stop only the calling session
├── demoPlugin.ts            # stop demos through registry handle
├── snapshotRegistry.ts      # invalidate this epic's snapshot
├── app.ts                   # wire narrow host-owned callbacks
└── factoryFleet.ts          # trusted third-gate appendix only
```

## Behavior — merged PR to durable completion

```mermaid
sequenceDiagram
    participant Tick as Supervision tick
    participant GH as GitHub CLI
    participant O as Orchestrator
    participant Host as close_epic
    participant R as Registries
    participant Owner as Inbox
    Tick->>GH: pr view epic branch
    GH-->>Tick: MERGED + PR + merge SHA
    Tick-->>O: factory_status.pr + prLookup
    O->>Host: close_epic(prNumber, cleanup=true)
    Host->>GH: verify same repo + branch + OID + merge
    Host->>R: stop demos; retain failures
    Host->>Host: require every child close/reuse succeeds
    Host->>R: force-with-lease branch + all-epic snapshot cleanup
    Host->>Host: close epic, stop calling supervision last
    Host-->>O: complete | partial receipt + sessions
    O->>Owner: Done only when complete
```

## Diff-shaped contract — what changes

```diff
 factory_status
   git: { branch, head, remoteHead, dirtyPaths }
   beads: [...]
   workerSessions: [...]
+  pr: { number, url, state, mergedAt } | null
+  prLookup: available | gh-unavailable | not-found | error

 Orchestrator tools
   dispatch_worker
   factory_status
   supervise
   demo_sandbox
+  close_epic({ prNumber, cleanup = true })
+    preflight exact PR/same-repo/head/OID + MERGED + merge SHA
+    stop demos -> require all child close/reuse results
+    optionally force-with-lease delete branch + invalidate all epic snapshots
+    close epic -> stop calling supervision last
+    return complete | partial retryable receipt + session ids
+
+if receipt.overall == complete
+  ask_user("[Feature Name] Done", required acknowledgement radio)
```
