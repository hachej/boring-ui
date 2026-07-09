# PR Plan

Use small PRs. Each PR should close one reviewable surface and include the verification from its package TODO.

## Landing Repos

| Package | Repo | PR Count | Notes |
| --- | --- | --- | --- |
| A1-external-token-auth | `hachej/boring-ui` | 1-2 | Server auth, token storage, token CRUD, CORS docs/tests. |
| A2-connector-packaging | `hachej/boring-ui` | 1 | New `integrations/pi-for-excel/` package and docs. |
| A3-workbook-identity-e2e | `tmustier/pi-for-excel` and `hachej/boring-ui` | 2 plus E2E proof | One upstream identity PR, one boring-ui resolver/connector PR, then live proof doc. |
| B1-host-seam-fork | `hachej/pi-for-office` | 1-2 | Fork discipline, Excel-preserving seam, PowerPoint host detection. |
| B2-powerpoint-mvp | `hachej/pi-for-office` plus `hachej/boring-ui` for B2-005 | 3-4 | PowerPoint context/read tools first, mutation/recovery tools second, Office-ref connector generalization/proof last. |
| C1-wrapper-shell-login-gate | wrapper soft fork (repo name decided in C1-001) | 2-3 | Wrapper shell, login gate, token wiring, demo-token deletion. |
| C2-model-gateway-policy | wrapper soft fork (client) plus `hachej/boring-ui` (gateway/login server beads) | 2-3 | Model policy module, gateway seeding, selection-path enforcement, UI curation. |
| C3-branding-packaging-release | wrapper soft fork | 2-3 | Branding/persona seam, manifest generation, production CSP, release proof. |

## A1 Slice

Prefer one PR if the diff stays small:

1. Add hashed workspace API token storage, store helpers, auth hook bearer path, token CRUD routes, and tests.
2. Split only if token CRUD UI/docs materially slows review; the first PR must still prove bearer auth on a protected workspace route.

Target branch: `bclaw/526-a1-token-auth`.

## A2 Slice

One boring-ui PR:

1. Add `integrations/pi-for-excel/boring-connector.mjs`.
2. Add connection-bundle template, install/runbook doc, and CI-runnable tests ported from the spike.
3. Add `integrations/*` to workspace tooling only if needed for the test package.

Target branch: `bclaw/526-a2-connector-packaging`.

## A3 Slices

PR 1 lands upstream in `tmustier/pi-for-excel`:

- Expose open-document identity to the extension API.
- Keep it host-safe and token-free.
- Document the `execute_office_js` fallback as interim only.

PR 2 lands in boring-ui:

- Add direct Microsoft Graph document URL resolver.
- Update connector docs/tests to consume document identity and save refs without manual IDs.
- Add live E2E instructions and proof template.

Target branches:

- Upstream: `office-doc-identity-extension-api`.
- boring-ui: `bclaw/526-a3-workbook-identity-e2e`.

## B1 Slices

PowerPoint host work lands in `hachej/pi-for-office`. The B2-005 Office-ref connector generalization lands in `hachej/boring-ui` before PowerPoint connector proof.

1. Fork setup, upstream remote, merge cadence doc, and shared-file guardrails.
2. `DocumentHost` seam with Excel adapter preserving current behavior.
3. PowerPoint manifest and host detection.
4. Upstream RFC issue text.

Target branch: `office/526-b1-host-seam`.

## B2 Slices

Land in `hachej/pi-for-office`, not boring-ui.

1. PowerPoint context/read tools and prompt context.
2. PowerPoint mutation tools and recovery checkpoints.
3. Office-ref connector generalization, PowerPoint connector reuse verification, and `.pptx.cloud.json` proof.

Target branches:

- pi-for-office: `office/526-b2-powerpoint-mvp`.
- boring-ui: `bclaw/526-b2-office-ref-generalization`.

## C Slices (Lane C — #551 wrapper)

**Amendment (2026-07-06):** landing repos for the C lane:

- C1, the C2 client work, and C3 land in the **wrapper soft fork** of `tmustier/pi-for-excel` (repo name decided in C1's first bead, C1-001).
- The **gateway/login server beads** land in `hachej/boring-ui`: the A1 browser-session login endpoint (workspace list + token issuance, per the amended A1 plan) and the C2 model-gateway server bead (gated on the C2 OPEN GATEWAY DECISION).

C1 PR 1 must delete the baked demo bearer token path and prove the login gate blocks runtime creation.

Every C-lane PR starts with an upstream merge from `tmustier/pi-for-excel` and records upstream drift for `src/taskpane/init.ts`, `src/compat/model-selector-patch.ts`, and `src/prompt/system-prompt.ts` in its description.

Target branches:

- wrapper fork: `boring/526-c1-wrapper-login-gate`, `boring/526-c2-model-policy`, `boring/526-c3-branding-release`.
- boring-ui: `bclaw/526-c2-model-gateway`.

## Lane C / Same-Definition Note

**Amendment (2026-07-08):** if the #551 wrapper lane is applied to this pack,
its PRs must describe Office integration as public API/model-gateway consumption
plus resolved environment attachment/fact consumption where applicable, not as an
attachment capability axis and not as a #391 canonical agent-definition
consumer. A future size-L work package is required if Office must consume the
same `AgentDefinitionDeclaration` as workspace/MCP/Slack/embed surfaces.

## Merge Gates

- All package verification commands pass.
- No token or secret appears in snapshots, refs, fixtures, or logs.
- A2 connector file remains reviewable as one `.mjs`.
- B-lane PRs can merge upstream `tmustier/pi-for-excel` main without broad conflict.
- A3 live proof uses self-hosted taskpane assets, not the author's Vercel deployment.
