# Boring UI implementation specification — [product]

Product spec/version: TBD. Framework repository and exact commit/package versions: TBD. Inspection date: TBD. Relevant host instructions: TBD.

Consult [the verified baseline](../../references/boring-ui.md) and refresh it before coding. A path in the table must refer to something actually inspected; otherwise label it proposed.

## Composition choice

- Existing host, new consuming app, or local prototype:
- Framework packages and verified versions:
- Agent prompt/skills/tools required:
- First slice's user journey:
- User-fit decisions: interaction depth, defaults, review/override, onboarding, and recovery:
- Persistence and deployment owner:
- Setup/maintenance expected from each actor and evidence that support is available:
- Existing capabilities to reuse and missing additions:

## Requirement mapping

| Requirement | User chat/interaction | Workbench result | Agent resource/tool | Server/data boundary | Verified source or proposed addition | Check |
| --- | --- | --- | --- | --- | --- | --- |
| FR-001 | TBD | TBD | TBD | TBD | TBD | AC-001 |

## Surfaces

For each proposed panel or document view, define its user task, content, inputs, actions, and idle/loading/empty/error/stale states. Reuse existing file views where sufficient. Define how a user and the agent see and modify the same underlying artifact.

## Tools and authority

For each tool, define its purpose, input schema, result, side effect, actor/workspace context, authorization enforcement, retries/idempotency, cancellation, and error behavior. Verify names against the installed framework; do not infer a tool API from an example label.

## Data and runtime

Define authoritative artifact/session stores, IDs, concurrency, state revisions, retention, access boundaries, and recovery after restart. If the product uses personal profiles, specify participant identity, private scope, correction, reuse, and isolation from public method files. Separate model suggestions from confirmed domain decisions. Describe capability degradation when a tool or provider is unavailable.

## Integration and proof

- Exact plugin resource/loading method verified in the target host:
- Front/server composition and restart requirements:
- Build/check commands from that repository:
- Task-level proof using real boundaries:
- Boring UI smoke test and limitations:
- Handoff, access, and operations:

This artifact is an implementation plan. Mark each requirement `proposed`, `implemented`, or `verified` with evidence; do not infer implementation from the presence of this document.
