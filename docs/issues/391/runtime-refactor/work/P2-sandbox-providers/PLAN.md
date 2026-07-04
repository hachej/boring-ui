# P2-sandbox-providers — Plan

> Phase: Phase 2 — `@hachej/boring-bash` package (bash track) · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [00-global-isa.md](../../architecture/00-global-isa.md) — the zero agent→bash/sandbox value-import invariant; open decision 3 (RESOLVED → boring-sandbox); provisioning-ownership rule.
- [02-boring-bash-environment.md](../../architecture/02-boring-bash-environment.md) — package layers, provider capability matrix, mode↔provider mapping, remote-worker split rules.
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) — decision 11: the three-package `boring-agent` ← `boring-bash` ← `boring-sandbox` stack and its acyclic import edges.

## Design context
Phase 2 stands up the three-package stack. Concrete providers do **not** land in `boring-bash/providers`; they move to a new dedicated `@hachej/boring-sandbox` package (`packages/boring-sandbox/src/providers`) that imports agent **types only**. `@hachej/boring-bash` (THE RUNTIME — the CHOICE of sandbox) owns runtime-mode resolution (`resolveMode`/`autoDetectMode`/`hasBwrap`), importing boring-sandbox **values** + agent **types**. The acyclic edges are: `sandbox → agent(types)`; `bash → sandbox(values) + agent(types)`; agent imports neither. This is also the first composition cutover (runtime-mode) — every in-repo composer that resolved a mode is migrated in-PR to inject the resolved adapter or import `@hachej/boring-bash/modes`; no old-path re-exports, no host shims. Providers do not move until Phase 1 injection is complete.

## Deliverables
- package skeleton and exports **[landed via #416: skeleton, shared filesystem-binding contracts, readonly/management company-context operations, fixture provider, leakage/conformance tests]**;
- **scaffold the new `@hachej/boring-sandbox` package** (sandbox management: providers, FUSE-S3 mounts, lifecycle, capability facts — imports agent **types only**);
- provider capability model; mode/provider mapping docs;
- move concrete provider implementations (direct, bwrap, vercel-sandbox, remote-worker client) to **`packages/boring-sandbox/src/providers`** (00 open decision 3, RESOLVED; 08 decision 11) — **not** `boring-bash/providers`;
- **runtime-mode resolution (`resolveMode`/`autoDetectMode`/`hasBwrap`) lands in `@hachej/boring-bash`** (THE RUNTIME: the CHOICE of sandbox), resolving a mode id to a `@hachej/boring-sandbox` provider value;
- provisioning ownership docs: agent owns engine/types over injected adapters; boring-bash owns requirement normalizer + runtime-mode resolution; **boring-sandbox owns the concrete provider adapters + capability facts**;
- remote-worker split docs: protocol/shared types → `boring-sandbox/shared`, client/provider adapter → `boring-sandbox/providers`, optional server package path;
- invariant/import boundary: **acyclic** `boring-sandbox → agent(types)`; `boring-bash → boring-sandbox(values) + agent(types)`; agent imports neither;
- migration strategy (v2, strict): **migrate every importer in the same PR** — no type-only old-path exports, no re-export stubs, no host shims that outlive the phase. Intra-phase transitional code carries `// TODO(remove:<bead-id>)` + a deletion bead.
- Do not move providers until Phase 1 injection is complete.

## Exit criteria
- package builds; no import cycle; current apps still compile after same-PR importer migration (no old-path re-export, no host shim); landed #416 contracts unchanged (governance consumers #476–#501 keep working).
