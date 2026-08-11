# Issue #1081 — sovereign sandbox service

Issue folder for the sandbox service (dogfood → product). One unified owner-gate
(**PR #1220**): the architecture/vision, the SBX1.4 execution plan, and the
control-plane API contract are the same product at three altitudes, reviewed
together. PR #1219 (the standalone execution plan) is **superseded by #1220** — its
content and review lineage are preserved here (see below).

## Read in this order

1. **Architecture & vision — the WHY + WHAT.**
   [`../../direction/sandbox-service-architecture.md`](../../direction/sandbox-service-architecture.md)
   — the four-layer product architecture, the dogfood-to-product staging, and the
   isolation ladder. Sits *above* the plan and is the authority on *what the slices
   are slices of*.
2. **Execution plan — the HOW + WHEN.** [`plan-sbx14.md`](plan-sbx14.md) — the
   single-box gVisor daemon build (S1 daemon+auth → S5 Seneca flip), the v1 module
   layout, provisioning/ops, the prod flip, the v1-complete exit criteria + the
   public-opening gate, and the per-slice review protocol. Authority on *what ships
   first*. Originated as PR #1219; **adversarially reviewed L1 (Opus, commit
   `e17242958`) + L2 (Fable, commit `0aedd1a9d`)** — see PR #1219 history.
3. **API spec — the CONTRACT.** [`api-spec.md`](api-spec.md) — the Layer-1
   control-plane API surface: the v1 endpoints, the capability + single-use-nonce
   auth handshake, the E2B-shaped-subset coverage map, and the `SandboxProviderV1`
   mapping. The plan and the architecture doc reference it; it is the single
   authority on the wire contract.
4. **Decision record — the WHY.** [`tech-choice.md`](tech-choice.md) — the
   standalone "why we chose what we chose" narrative: for each of the ten major
   tech choices (build-vs-adopt, gVisor-vs-microVM, systrap-vs-KVM, daemon-vs-managed
   -k8s, orchestration, harvest-E2B, CH/EU sovereign hosting, Node/TS daemon,
   Tailscale+capability auth, product path) it states the Question, Options,
   Evidence (verbatim primary-source quotes + citations), Decision, and Reasoning.
   Synthesizes the grounding in (5); readable end-to-end by an engineer or investor.
5. **Grounding — the EVIDENCE.** [`references/`](references/) — version-controlled
   research artifacts (raw E2B API research, E2B internals, isolation primary
   sources, build-vs-adopt survey, scoping). Every decision in (1)–(4)
   cites a file here. Index: [`references/README.md`](references/README.md).

## Grounding rule

No API or architecture decision in this folder is ungrounded: each cites a primary
source (competitor docs, E2B source tree, or our own shipped code) via
`references/`. When adding a decision, add or cite its evidence in `references/`.
