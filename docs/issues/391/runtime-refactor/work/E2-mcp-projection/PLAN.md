# E2-mcp-projection — Plan

Status: post-v1; not a #391 v1 exit gate.

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
E2 consumes the injected P6-R `DeploymentAttachmentCatalog`; it creates no
second address store. It receives E1 auth-gated contributions, never raw
prepared handles or long-lived operation objects. Remote-worker stays a provider (P2/P5); its
reclassification as an environment transport is a deferred post-E2 P8 follow-up.

## Verified current repo reality (pre-E2)
- `packages/boring-bash/package.json` currently has no `@modelcontextprotocol/sdk` dependency and exports only `.`, `./shared`, and `./server`. E2 adds an exact `@modelcontextprotocol/sdk` dependency and a new `./mcp` export.
- `plugins/boring-mcp/package.json` currently declares `@modelcontextprotocol/sdk` as `^1.29.0`; `pnpm-lock.yaml` resolves `@modelcontextprotocol/sdk@1.29.0`. E2 must add `1.29.0` exactly to `@hachej/boring-bash` (no caret), not rely on the plugin range.
- Existing production MCP SDK use is client-side in `plugins/boring-mcp/src/server/mcpSdkTransport.ts` (`Client` + `StreamableHTTPClientTransport`). Existing tests already import server-side SDK classes (`McpServer`, `StreamableHTTPServerTransport`) for fake MCP servers, so the server APIs and paths are verified in this repo.
- The projection-operation enforcement code E2 must reuse is `packages/boring-bash/src/server/readonlyProjectionOperations.ts` and `packages/boring-bash/src/server/managementProjectionOperations.ts`; denied-path errors have stable exported codes.

## Deliverables
- MCP server projection for a catalog-resolved attachment: fs ops (+ exec where
  policy allows) as MCP tools. Every call authenticates/revalidates its request
  context and invokes an E1 contribution closure, which enters
  `withAuthorizedView`; existing readonly/management ops remain the enforcement
  implementation inside the lease. P6-R supplies the injected lookup.
- The projection factory accepts ref+catalog+lifetime owner and derives facts/
  policy/contributions as one bound unit. It never accepts independently
  supplied contributions that could belong to a different attachment.
- No-leak conformance suite runs against the MCP projection (same suite, MCP mount; delivered mounts by name: in-process, scoped-view, MCP — the remote-worker provider mount is deferred to BBP5-010).
- Remote-worker stays a provider in this epic (P2/P5). Reclassifying it as an environment transport is deferred to a post-E2 follow-up filed at P8 — not an E2 deliverable.

## Exit criteria
- An external MCP client (e.g. Claude Code) mounts a boring environment and sees exactly what an in-process readonly attachment sees.
- Denied files are absent over MCP (no-leak).
- No broker secret is reachable from the client.
- Every MCP operation reauthenticates and enters a fresh callback-scoped E1
  lease; expired/revoked/foreign identity fails even on an established session.
