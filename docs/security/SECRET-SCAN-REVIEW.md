# Historical secret-scan review

Reviewed on 2026-10-09 for migration PR #1609, starting at
`62c7ab1d0fce`.

Gitleaks 8.28.0, verified against the workflow checksum, reproduced 130 findings
across 8,976 commits with `git --log-opts="--all"`. These represent 24 distinct
rule/value pairs. Source context was reviewed for every group. No confirmed live
credential was found among these findings. This conclusion covers this scanner's
findings, not every possible secret in the repository.

The exceptions in [../../.gitleaks.toml](../../.gitleaks.toml) require the matching
rule, exact extracted value and exact historical file path together. They do not
exclude a directory, an entire detector or all UUIDs/hashes. Repeated appearances
in retained logs and commits account for the difference between 24 values and
130 findings. Historical files removed by the migration remain scanned.
The [per-finding review](secret-scan-findings.json) records all 130 locations
with abbreviated commit IDs, detector rules and dispositions.

| Review | Findings | Disposition and source evidence | Representative source |
| --- | ---: | --- | --- |
| H01 | 2 | WebSocket handshake nonce in a local server test, base64 for the sample nonce. | `331f62bf9117` / `packages/workspace/src/server/__tests__/createWorkspaceAgentServer.listening.test.ts:42` |
| H02 | 10 | Hard-coded invitation UUID in mocked authentication and URL-parsing tests. | `db0921461096` / `packages/core/src/front/__tests__/SignInPage.test.tsx:227` |
| H03 | 5 | Credential-review prose describing idempotency and concurrency, not a credential. | `9dfd82aa94cf` / `docs/plans/long-term/research/10-raw-worker-reports/c4-credentials-attack.md:537` |
| H04 | 30 | Literal idempotency-1 request identifier in recorded fictional task fixtures. | `9dfd82aa94cf` / `docs/plans/long-term/research/10-raw-worker-reports/s1b.log:1260` |
| H05 | 29 | Literal idempotency-2 request identifier in recorded fictional task fixtures. | `9dfd82aa94cf` / `docs/plans/long-term/research/10-raw-worker-reports/s1.log:2236` |
| H06 | 1 | Python Qwen3_5ForCausalLM class name in recorded documentation search output. | `9dfd82aa94cf` / `docs/plans/long-term/research/10-raw-worker-reports/s5.log:6836` |
| H07 | 1 | Python Qwen3ForCausalLM class name in recorded documentation search output. | `9dfd82aa94cf` / `docs/plans/long-term/research/10-raw-worker-reports/s5.log:6836` |
| H08 | 6 | Git diff index object ID in recorded patch output, not a Sourcegraph token. | `9dfd82aa94cf` / `docs/plans/long-term/research/10-raw-worker-reports/c1.log:5131` |
| H09 | 4 | Git diff index object ID in recorded patch output, not a Sourcegraph token. | `9dfd82aa94cf` / `docs/plans/long-term/research/10-raw-worker-reports/c1.log:14528` |
| H10 | 6 | Git diff index object ID in recorded patch output, not a Sourcegraph token. | `9dfd82aa94cf` / `docs/plans/long-term/research/10-raw-worker-reports/w4.log:13187` |
| H11 | 1 | Local SQLite durable-pause restart-proof continuation ID in recorded test output. | `9dfd82aa94cf` / `docs/plans/long-term/research/10-raw-worker-reports/s4.log:20832` |
| H12 | 2 | Local SQLite durable-pause restart-proof continuation ID in recorded test output. | `9dfd82aa94cf` / `docs/plans/long-term/research/10-raw-worker-reports/s4.log:29077` |
| H13 | 8 | Local SQLite durable-pause restart-proof continuation ID in recorded test output. | `9dfd82aa94cf` / `docs/plans/long-term/research/10-raw-worker-reports/s4.log:29670` |
| H14 | 4 | Tokenizer artifact SHA-256 in the feasibility result manifest. | `d8e080671d3a` / `docs/issues/912/feasibility/2026-07-24-gate-results.md:52` |
| H15 | 4 | API.md artifact SHA-256 in the contract-proof hash manifest. | `d8e080671d3a` / `docs/issues/912/spikes/whisperlivekit/gh912-wlk-contract-proof.mjs:27` |
| H16 | 4 | Tokenizer artifact SHA-256 in the contract-proof hash manifest. | `d8e080671d3a` / `docs/issues/912/spikes/whisperlivekit/gh912-wlk-contract-proof.mjs:35` |
| H17 | 1 | Explicit synthetic API_KEY_CANARY in the localhost credential-vault test. | `f01973f14a00` / `packages/core/src/server/db/stores/__tests__/PostgresCredentialVaultStore.test.ts:27` |
| H18 | 1 | MAX_OVH_KMS_WRAPPED_KEY_BYTES_V1 size-limit identifier in a conditional expression. | `f01973f14a00` / `packages/agent/src/server/credentials/kek/ovhKms.ts:183` |
| H19 | 1 | Literal idem-compat-747 operation identifier in the SDK compatibility fixture. | `e5310f9ecbaa` / `packages/agent/src/server/harness/pi-coding-agent/__tests__/piSdkCompatibility.test.ts:109` |
| H20 | 3 | D1_SECRET_UNAVAILABLE error-code enum value. | `cedbc5736415` / `apps/full-app/src/server/deployment/d1Plan.ts:10` |
| H21 | 3 | D1SecretRefsEnvelopeV1 TypeScript type annotation. | `43fbbdf547e2` / `apps/full-app/src/server/deployment/hostRevisionStore.ts:31` |
| H22 | 1 | FORBIDDEN_FINANCE_SECRET_123 sentinel in the documented denied-finance fixture. | `4c43993bfcea` / `.beads/issues.jsonl:296` |
| H23 | 2 | docs-v5-launch browser storage key in a documentation banner example. | `38e61b128d97` / `.agents/skills/documentation-website-for-software-project/references/ADVANCED-NEXTRA.md:546` |
| H24 | 1 | Truncated JWT example ending in three literal dots, not a complete signed token. | `c57618cfe2bb` / `.beads/notes/bd-sprites-provider.md:158` |

The H11-H13 continuation IDs come from the local `spike-durable-pause` SQLite
restart proof, including child-process SIGKILL and completed-answer output. They
are not service credentials. H08-H10 occur in Git diff `index` lines. H14-H16 are
artifact hash manifests, and the contract-proof script imports `createHash` to
verify downloaded bytes. H24 is an explicitly truncated example with a fictional
sandbox URL; it is not a complete JWT.

## Verification

- The same pinned full-history scan with the proposed configuration scanned
  8,976 commits and reported zero findings.
- A separate temporary Git fixture included the reviewed WebSocket nonce and a
  newly generated, fictional GitHub-token-shaped value in the same allowed file.
  The nonce was ignored and the new token was detected by `github-pat`.
- The same nonce in another file was still detected by `generic-api-key`.
- Default rules and full-history scanning remain enabled. No Git history was
  rewritten and no credential was exercised against a live service.

## Required CI checks

On 2026-10-09 the destination repository's `main` branch protection was updated
from the seven retired legacy workflow names to `verify`,
`Isolated package consumers`, `Studio scripted journeys` and `Secret scan`,
all bound to the GitHub Actions app. The previous strictness and review settings
were preserved. The secret scan is now explicitly required.

This resolves migration-specific secret findings and obsolete check names.
The eleven release-proof deferrals remain owned by
[../../VERIFY.json](../../VERIFY.json). Merge readiness and npm publication
qualification are separate; this change publishes nothing.
