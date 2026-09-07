# Show me — gh-1562 native creation, first journey

Three layers, ruled 2026-09-07:

```text
Host (control plane + broker)
  identity · membership · installation records · activation receipts
  WorkspaceBridge: product.v1.* (nc-3) · product.op.<installation>.* (nc-4a)
    │ brokered calls only
    ▼
Product runtime (one per installed product; mode = host policy)
  embedded  → RuntimeBackendRegistry in-process (gated default-off, nc-0)
  local     → bwrap/runsc lease + runtimeEntry.ts (nc-4b)
  remote    → microVM (later)
  serves: declared operations · generated front bundle (iframe, nc-5)
    ▲ built in
Sandbox (disposable lease, D31) — builder works here, never serves from here
```

Release → installation → activation:

```mermaid
sequenceDiagram
    participant B as product-builder (nc-6)
    participant H as Host bridge (nc-3)
    participant R as Release store (nc-1)
    participant I as Installation store (nc-2)
    participant P as Product runtime (nc-4)
    B->>R: put(manifest) → releaseDigest
    B->>H: product.v1.propose(releaseDigest)
    H->>I: activate(installationId, releaseDigest, expectedGeneration, requestKey)
    I-->>H: receipt prepared → committed | aborted(stale-generation)
    H->>P: start(installation, release) → register declared ops
    Note over H,P: retry with same requestKey returns the same receipt
```

Bead graph:

```mermaid
graph LR
  nc0[nc-0 embedded gate] --> nc3[nc-3 bridge ops]
  nc1[nc-1 release manifest] --> nc2[nc-2 installation + activation]
  nc2 --> nc3
  nc0 --> nc4a[nc-4a runtime seam]
  nc3 --> nc4a
  nc4a --> nc4b[nc-4b local adapter]
  nc3 --> nc5[nc-5 isolated front]
  nc4a --> nc6[nc-6 builder seat]
  nc4b --> nc7[nc-7 first journey]
  nc5 --> nc7
  nc6 --> nc7
```

File layout added by the epic:

```diff
 packages/workspace/src/server/
+├── productLifecycle/   # releases, installations, activation, bridge (nc-1..3)
+├── productRuntime/     # types, embedded, local, brokeredOps (nc-4a/4b)
 └── runtimeBackend/     # becomes the embedded adapter's engine (nc-0)
 packages/workspace/src/front/
+└── productRuntime/     # IsolatedProductPanel + postMessage broker (nc-5)
 packages/core/drizzle/
+├── 0028_product_releases.sql
+└── 0029_product_installations.sql
+plugins/product-builder/  # builder agent type + tools (nc-6)
 apps/workspace-playground/
+└── fixtures/products/math-tutor/ + scripts/first-journey-acceptance.mjs (nc-7)
```
