# E2-mcp-projection — Plan

> Phase: Phase E2 — MCP environment projection (after E1) · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [09-environments-attachable.md](../../architecture/09-environments-attachable.md) — § "MCP projection: external reuse for free" and § "Security invariants": the external-agent transport E2 delivers over the same enforcement.

## Design context

E2 projects any environment through an MCP server: fs ops (plus exec where policy
allows) as capability-gated MCP tools. Enforcement **reuses the existing readonly /
management projection operations verbatim** — the MCP handlers are thin adapters
(`read` tool → `operations.read(descriptor)`), with a denied path throwing the
existing projection error and mapping to an MCP error result without leaking the
path. There is no second enforcement path. Tool surface is gated by the attachment:
read-family always; `write`/`edit` only iff `access: 'readwrite'`; `exec` only iff
`execPolicy: 'attached'`. Each MCP session maps to exactly one `BoundFilesystemContext`
(v1: token-per-projection minted only for a workspace-bound context — invariant 5),
so every tool call carries the same audit identity as an in-process attachment.
E2 introduces the address-by-id lookup (a plain `Map<environmentId, Environment>`)
that E1 deliberately ships without — this is the first place the projection needs
to resolve an environment by id. Remote-worker stays a provider (P2/P5); its
reclassification as an environment transport is a deferred post-E2 P8 follow-up.

## Deliverables
- MCP server projection for any environment: fs ops (+ exec where policy allows) as MCP tools, enforcement via the existing readonly/management projection operations; MCP session → `BoundFilesystemContext` identity mapping. E2 introduces the address-by-id lookup (a plain `Map<environmentId, Environment>`) it needs to resolve an environment by id.
- No-leak conformance suite runs against the MCP projection (same suite, MCP mount; delivered mounts by name: in-process, scoped-view, MCP — the remote-worker provider mount is deferred to BBP5-010).
- Remote-worker stays a provider in this epic (P2/P5). Reclassifying it as an environment transport is deferred to a post-E2 follow-up filed at P8 — not an E2 deliverable.

## Exit criteria
- An external MCP client (e.g. Claude Code) mounts a boring environment and sees exactly what an in-process readonly attachment sees.
- Denied files are absent over MCP (no-leak).
- No broker secret is reachable from the client.
