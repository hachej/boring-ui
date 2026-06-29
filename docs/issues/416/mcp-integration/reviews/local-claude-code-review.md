Confirmed: pure design doc, no code yet, and prior Claude/Gemini passes already GREEN-ed it after amendments. That's exactly when fresh-eyes scrutiny matters most — the amendments bolted fixes on without reconciling the earlier sections. Here's my review.

---

# Architecture Review — `docs/issues/416/mcp-integration/plan.md`

**Verdict: NOT GREEN.** The design is thoughtful and the security instincts are right, but the doc has accreted through ~5 review passes + Gemini amendments and now contradicts itself on the single most load-bearing decision (the V0 tool surface). Prior reviews GREEN-ed each amendment in isolation without reconciling the earlier sections, so the contradictions are still live. Blockers below would cause implementers to build the wrong thing.

## Blockers

**B1 — Three mutually contradictory "canonical" V0 tool surfaces.** The doc defines the agent tool set three times, each different:
- §"Generic agent tools" (L123–132): 8 tools incl. `mcp_tools_list`, no search/describe.
- §"V0 — generic proxy tools" (L388–392): **3 tools only** (`mcp_tools_search`, `mcp_tool_describe`, `mcp_readonly_call`) — no list/status/doctor/probe/resources.
- §"Gemini amendments / V0 tool interface" (L685–697): 9 tools, adds pagination, *deprecates* `mcp_tools_list`.

There is no statement of which supersedes which. An implementer cannot start without picking, and two of three picks are wrong. This is the exact "drift" the plan polices elsewhere — present in its own spec. **Fix:** delete/clearly-mark the superseded sections; leave one canonical V0 surface (the L685 list reads as intended-final).

**B2 — Acceptance criteria require zero executable verification.** All six criteria (L188–194) are "doc contains X / X is documented / X is specified." A plan this full of testable contracts (every interface section ends with a `Tests must cover…` list) can be marked "done" with no compiling code, no fake-client facade test passing, no end-to-end read call. **Fix:** acceptance must include the foundation's own promised artifacts — at minimum the fake-client facade + redaction + drift tests green, and one read-only call resolved through the facade against a stub transport. Otherwise "foundation accepted" = "markdown written."

## Highs

**H1 — Classification is name-regex-based and ignores MCP-native signals.** The whole policy engine keys off `create_*/update_*/...` deny globs + manual allowlists (L107–117, L246). MCP already provides structured tool annotations (`readOnlyHint`/`destructiveHint`/`idempotentHint`) and `notifications/tools/list_changed`. The plan reinvents classification by string-matching while the protocol offers typed signals — brittle (a mutating tool not named `create_*`, or a benign `get_*` that writes, defeats it) and it leaves the most natural drift trigger (`list_changed`) on the table. **Fix:** make tool annotations a first-class classification input (still subordinate to checked-in allowlist for *enabling*), and use `list_changed` as a probe/drift trigger.

**H2 — "Drift disables stale entries" is only as strong as an undefined probe cadence.** V1 search reads the **cached** catalog, never live (L490); drift detection requires **live probe** (L150, L215); but probe is **manual** (L213–219, "Admin/reviewer updates…"). Nothing schedules re-probe or expires a classification. So a tool can read `enabled: true` from cache indefinitely while live schema has breaking drift — the safety guarantee is unbacked. **Fix:** define probe cadence/TTL or a classification freshness bound that forces `MCP_PROVIDER_TOOL_DRIFT`/disable when stale.

**H3 — Over-abstraction relative to a zero-code starting point.** Foundation commits **seven** interfaces (`RedactionGuard`, `CredentialProvider`, `PolicyClassifier`, `ExecutionGuard`, `ConnectionManager`, `ProviderTemplate`, `ToolsSearch`) + V0/V1/V2 roadmap + a 6-condition V2 materialization gate (L494–503) — all with fake/noop V0 impls, before one real transport call exists. `McpExecutionGuard` (before/after/afterFailure) and `McpConnectionManager` overlap in responsibility. These will churn the moment the real MCP SDK client lands and reveals actual lifecycle/error shapes. **Fix:** shrink committed surface to what's needed to make one real read-only Notion/Airtable call end-to-end; demote V1/V2 + breaker/metrics hooks to non-binding design notes.

**H4 — Connection-cache vs token-refresh lifecycle is unspecified — a credential-correctness gap.** `McpConnectionManager` caches clients keyed by "config version" (L726) and clients hold an `Authorization` header derived from `McpResolvedCredential.accessToken`. On refresh/revoke, nothing ties cache invalidation to credential rotation. A cached client can carry a stale/revoked token → failures or use-after-revoke. The plan insists tokens never leak to the agent but never states tokens never persist in the client cache beyond their `expiresAt`. **Fix:** cache key or invalidation must include credential identity/expiry; `refreshIfNeeded` must close/rebuild affected clients; revoke must purge cached clients (L728 says "best-effort" — too weak for a revoked credential).

## Mediums

**M1 — Config access conflicts with repo path invariants.** Mode A reads `.mcp.json` / `.pi/mcp.json` (L554) and the agent-writable-path rules (L668–679) require knowing which paths are agent-writable. But AGENTS.md invariants #3/#4 say routes/tools receive `Workspace`, not raw paths, and path validation belongs to adapters. The plan reads raw config paths directly. Reconcile: config + writability checks must route through the Workspace/adapter contract, not raw fs.

**M2 — Actor/ownership model undefined for CLI mode.** Policy "source must belong to actor" (L137) and per-actor cache keys assume multi-tenant identity. In single-user CLI Mode A there's no defined actor — the rule is either vacuous or unspecified. Define the CLI actor (or state the rule is hosted-only).

**M3 — Resource tools ship dead for both launch providers.** V0 includes `mcp_resources_list`/`mcp_resource_read` (L693–694), but resource reads are denied without `allowedResourceUriPrefixes` (L379–380), and neither the Notion nor Airtable template declares any (L72–105). Every resource call for the shipped providers is denied. Drop resource tools from V0 or add prefixes.

**M4 — `schemaHash` canonicalization unspecified.** Drift hinges on schema hashing, but no canonicalization (key order, whitespace, `$ref` resolution) is defined → semantically-identical schemas hash differently → spurious drift → false disables. Specify the canonical form.

**M5 — "Review drift keeps bridge tools enabled if input compatibility is preserved" (L663) invites a buggy half-implementation.** JSON-schema input-compatibility checking is a real sub-project (subtyping). As written it tempts a partial impl that wrongly keeps drifted tools live. For V0, prefer hash-mismatch → disable; defer compatibility logic, or specify it precisely.

**M6 — `assertSafeForAgent` can hard-fail legitimate reads.** It throws `MCP_SECRET_LEAK_GUARD` (L266); with the regex *fallback* (L655) still active, a provider response legitimately containing a token-like substring blocks the user's own data — a self-inflicted denial. Define behavior when only the regex (not a seeded exact value) matches: redact-and-pass vs hard-fail.

**M7 — `toolNamePattern?: RegExp` doesn't round-trip as checked-in data.** Templates are described as "checked-in docs/provider artifacts [that] mirror this registry shape" (L348), implying JSON/data, but `RegExp` isn't JSON-serializable. Signals an unresolved template-as-code vs template-as-data ambiguity; pick one (a string pattern + flags if data).

**M8 — Two sources of truth for the design itself.** A prototype lives on `feat/generic-mcp-onboarding` in a *different repo* (`hachej/boring-ui-constellation`, L196–198) while this is the "tracking home." No reconciliation/extraction plan is defined → design here and code there will drift. State who extracts what, when, and which doc wins on conflict.

---

**Net:** Resolve B1 and B2 before any implementation; B1 because there's no single contract to build against, B2 because "done" currently means nothing executable. H1–H4 materially change the engine's correctness/scope. I confirmed there is **no MCP code in this repo yet** — so this is the cheap moment to cut H3's surface and fix the contradictions before they get encoded.

Note: I have a wakeup scheduled in ~1 min from the grounding wait; it'll fire once and I'll just close it out — no further action needed from you.
