# Plan Review Pass 2

Document: `docs/issues/416/mcp-integration/plan.md`
Review date: 2026-06-28
Sections added: lessons, classification, production-readiness

## Review

### Correct
- **Scope split** between foundation and hosted scope is clear and well-bounded.
- **Provider templates** for Notion/Airtable include concrete endpoint, transport, auth, and mode details.
- **Tool classification workflow** is conservative: heuristics cannot enable tools by themselves; schema hash drift disables affected tools.
- **Lessons section** correctly identifies transport abstraction, lazy lifecycle, idle cleanup, proxy-tool pattern, and caching strategy as actionable guidance.
- **Production readiness dependencies** explicitly lists what is deferred and what hooks should exist in the foundation.
- **Policy rules** are specified with deny-before-allow, tool name regex validation, and input/URI size limits.
- **Status/doctor/probe** lifecycle is clearly differentiated (static state vs. local validation vs. live connect).

### Blocker
- **None.** The plan is a design document with no critical gaps that prevent proceeding.

### High
- **Redaction guard interface not specified.** The plan states "redaction/secret leak guard" is foundation scope and "redaction guard before logs/tool responses" is a production dependency, but no interface or mechanism is defined for how redaction is applied at the transport/response level. This should be addressed before implementation.
- **Credential storage interface deferred without contract.** The plan defers encrypted credential/token storage but does not define the interface/contract that the foundation should expose for when this is added. Foundation should define the abstraction even if implementation is later.
- **Classification workflow lacks testing strategy.** The manual classification workflow is described but there is no mention of how to test classification correctness, drift detection, or policy updates.

### Medium
- **Provider-specific classification metadata structure.** The policy matching note mentions supporting "provider-specific classification metadata" but does not specify the shape or where it lives (template file? registry? external config?).
- **Admin UI for classification.** The workflow mentions "Admin/reviewer updates checked-in provider template/policy" but there is no discussion of whether an admin UI will be built or if this remains a code-change workflow.
- **Rate limit/circuit-breaker hooks undefined.** The plan says "foundation should leave hooks for" rate limits and circuit breakers but does not specify what those hooks look like (interfaces? config keys? extension points?).
- **Tool name regex may not fit all providers.** The regex `^[A-Za-z0-9_.:-]{1,128}$` is specified but providers with different naming conventions (e.g., camelCase with numbers at start, special chars) may need extensibility.

---

**Verdict: GREEN with notes.** The plan is sound. Address the High items (redaction interface, credential storage contract, classification testing) before or during implementation. Medium items can be refined iteratively.
