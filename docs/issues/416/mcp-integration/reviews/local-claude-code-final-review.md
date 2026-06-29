Re-review complete. I read the current `plan.md` in full and checked it against the prior final review's residual **M8** plus scanned for new contradictions.

## M8 (source-of-truth / extraction) — now closed

The prior review left M8 partial because the Implementation note didn't state precedence explicitly or bound the reconciliation. The current L214–216 closes it:

- **Source of truth — explicit:** "This issue pack is the boring-ui #416 tracking home and source of truth for the generic `boring-mcp` contract."
- **Reconciliation procedure — present:** "the implementer must reconcile that prototype against this plan."
- **Precedence rule — now explicit (was implicit):** "on conflict, this plan governs the generic contract and Constellation-specific code must adapt or remain app-local."
- **When — bounded:** gated "Before extracting shared code into a boring-ui package/plugin."

The only thing still unstated is a *named* owner and a *specific PR number* — but "the implementer, before extraction" is appropriate granularity for a design doc, not a Medium. M8 no longer rises to blocker/high/medium.

## New contradictions — none

- The three tool-surface sections (L119–138 canonical, L420–428 V0 minimal, L718–739 Gemini amendments) all agree: same 7 bridge tools + 2 optional resource tools, with `mcp_tools_list` consistently marked deprecated/superseded.
- Resource tools are uniformly gated on provider-declared URI validators/prefixes across L133–138, L414, L428, L732–748.
- The richer `McpToolsSearchRequest` (L504, adds `risk?`) is the V1 contract and is explicitly additive over the V0 bridge signature — not a conflict.
- Deferred surfaces (ExecutionGuard, V2 materialization, ConnectionManager) remain consistently scoped as fake/noop/later-gated.

## Verdict

**GREEN.** No blockers, highs, or mediums. M8 is resolved to the level a design doc supports; a named extraction owner + PR number is a cheap optional polish, not a gate.
