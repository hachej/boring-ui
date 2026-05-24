# WorkspaceBridge RPC v1 epic completion

Bead: `boring-ui-v2-reorg-14a9`
Date: 2026-05-24

## Verdict

WorkspaceBridge RPC v1 is complete for the scoped ask-user and Macro bridge program. All child beads for the epic are closed. The only remaining ready issue is unrelated legacy `apps/agent-frontend` migration (`boring-ui-v2-63q`), which is documented as blocked on a future browser harness.

## Child evidence

- `boring-ui-v2-reorg-pkqe` — Macro large output file-asset/raw-file fallback shipped.
- `boring-ui-v2-reorg-ccdn` — Ask-user Questions UX/draft bridge test shipped.
- `boring-ui-v2-reorg-795d` — Ask-user final audit shipped (`docs/verification/ask-user-audit.md`).
- `boring-ui-v2-reorg-q5xy` — Downstream Macro front/SDK bridge migration shipped in `/home/ubuntu/projects/boring-macro` commit `00f9ba71a`.
- `boring-ui-v2-reorg-poox` — Security/non-regression aggregator shipped (`docs/verification/workspace-bridge-security-aggregator.md`).
- `boring-ui-v2-reorg-32tn` — WorkspaceBridge v1 docs shipped (`docs/WORKSPACE_BRIDGE_V1.md`).

Earlier child beads closed the shared RPC contract, `emitUiEffect` rename, runtime token/env path, HTTP transport/auth/audit/idempotency layers, pending-question runtime, ask-user Pi extension/front cutover, hard server-surface removal, Macro bridge handlers, and bridge tests.

## Final checks

```bash
br dep cycles
# ✓ No dependency cycles detected.

bv --robot-insights | jq '.Cycles'
# null
```

Previously captured gates in child beads:

- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm lint:invariants` — passed.
- `pnpm --filter @hachej/boring-workspace run test` — passed.
- `pnpm --filter @hachej/boring-agent run test` — passed.
- `pnpm --filter @hachej/boring-ask-user exec vitest run --maxWorkers=1` — passed.
- Downstream Macro `pnpm typecheck` and `pnpm test` — passed.

Known environment/provider skips:

- Root `pnpm test` is blocked in this container by local Postgres credentials for core DB suites (`PostgresError: password authentication failed for user "ubuntu"`, SQLSTATE `28P01`). WorkspaceBridge-relevant non-DB suites passed directly.
- Live Macro direct/local/vercel provider smoke is deferred until a live Macro provider/WorkspaceBridge host is available; downstream unit coverage verifies bridge request shapes, bearer env parsing, idempotency, and redaction.

## Success criteria status

- `ask_user` works through front + Pi extension + `human-input.v1.*` bridge handlers.
- Ask-user no longer requires plugin-owned server routes in supported setup.
- Pending-question runtime is workspace-owned and DB-free with injected store seams.
- Runtime SDK bridge tokens/env are scoped and redacted.
- Macro browser/front and runtime SDK data paths use WorkspaceBridge without localhost assumptions.
- Large Macro output fallback uses existing file-asset/raw-file pipeline; no artifact service and no generic workspace file RPC.
- `WorkspaceBridge.emitUiEffect` is canonical UI side-effect dispatch with no public compatibility alias.
