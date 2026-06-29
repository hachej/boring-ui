I've reviewed the current `plan.md` against every prior finding. The "after-fixes" review file is empty (0 content), so I produced the re-review directly. Here it is.

---

# Re-Review — `docs/issues/416/mcp-integration/plan.md` (post-reconciliation)

**Verdict: GREEN**, with one residual **Medium** (process/coordination, not architecture correctness).

## Prior findings — all resolved

| ID | Prior issue | Status in current plan |
| --- | --- | --- |
| **B1** | Three contradictory "canonical" V0 surfaces | **Fixed.** L119–138 is now explicitly "the single canonical V0 agent tool surface… older `mcp_tools_list`-only sketches are superseded." L416–428 and L718–739 both reference/match it (same 7 tools + optional resources). No live contradiction remains. |
| **B2** | Acceptance was 100% "doc contains X" | **Fixed.** L204–212 adds executable "Implementation acceptance": facade path, fake/stub transport read-only call through search/describe/call, redaction tests, policy tests, drift tests, CLI config-trust test, hosted credential refresh/revoke test. |
| **H1** | Classification ignores MCP-native signals | **Fixed.** L240 + L320–325 make `readOnlyHint/destructiveHint/idempotentHint` first-class classification inputs (subordinate to checked-in allowlist for *enabling*), and `notifications/tools/list_changed` is a re-probe/stale trigger. |
| **H2** | Probe cadence/TTL undefined → unbacked safety | **Fixed (conceptually).** L525 mandates a catalog freshness TTL (stale → re-probe or mark unavailable); L240 list_changed trigger; acceptance covers "stale classification TTL." Numeric default left to impl, which is fine for a design doc since the contract now forces staleness→disable. |
| **H3** | Over-abstraction before one real call | **Fixed.** ExecutionGuard (L338), V2 materialization (L529), and ConnectionManager (L752) are now explicitly fake/noop/deferred until one read-only call is green. Surface demoted to non-binding notes. |
| **H4** | Connection-cache vs token-refresh lifecycle | **Fixed.** L767–774: cache key includes credential version/expiry bucket; refresh closes/rebuilds clients with old token; revoke must purge local clients before returning success ("best-effort" now correctly scoped to *other* processes in distributed deploys). Backed by acceptance test. |
| **M1** | Raw config paths vs Workspace invariant #3/#4 | **Fixed.** L591 + L711–716 route config discovery/writability through Workspace/adapter contract, no raw fs trust. |
| **M2** | CLI actor undefined | **Fixed.** L667 defines synthetic local actor (from local user/profile + project identity) for ownership/cache/audit; table row L650 matches. |
| **M3** | Resource tools ship dead for both providers | **Fixed.** L133–138 / L428 make resource tools optional, gated on provider-declared URI validators/prefixes — not in default V0 surface. |
| **M4** | `schemaHash` canonicalization unspecified | **Fixed.** L394: stable key ordering, whitespace-insensitive, normalized `$ref` expansion, provider/version in hash domain. |
| **M5** | Compatibility-checker half-impl temptation | **Fixed.** L396 / L700: V0 = hash mismatch disables; compatibility-keep-enabled is explicitly a later, test-gated optimization. |
| **M6** | `assertSafeForAgent` hard-fails legit token-like data | **Fixed.** L291–292: exact seeded matches hard-fail/redact by target; regex-only fallback is redact-and-flag, not hard-fail. |
| **M7** | `toolNamePattern: RegExp` not JSON-serializable | **Fixed.** L370 now `{ source: string; flags?: string }` — round-trips as checked-in data. |

## Residual

**M8 (still partial) — Two sources of truth, no extraction plan.** L214–216 now asserts this pack is the "tracking home for the generic design" (establishing doc precedence — an improvement over the prior version). But it still doesn't state *who* extracts the `feat/generic-mcp-onboarding` prototype from `hachej/boring-ui-constellation`, *when*, or the reconciliation procedure if prototype code and this spec diverge. The precedence rule ("this doc wins on conflict") is now implicit but not explicit, and there's no extraction owner/timeline. Low severity — coordination risk, not a design defect — but it's the one prior finding not fully closed. One sentence ("X extracts to package Y before PR Z; on conflict this doc governs the generic contract") would close it.

---

**Net:** Both blockers and all four highs are genuinely resolved (not just papered over — the reconciliation is internally consistent, and the previously-contradictory tool-surface sections now agree). The doc is implementable against a single contract with executable acceptance. I'd call it GREEN; M8 is a cheap follow-up, not a gate.
