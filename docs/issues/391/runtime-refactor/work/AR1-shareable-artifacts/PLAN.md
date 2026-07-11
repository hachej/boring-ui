# AR1-shareable-artifacts — Plan

Status: spec settled 2026-07-11 (owner-grilled). Scope is SMALL: deep-link
route + share entries + tombstone rendering. Depends on
[ID1](../ID1-agent-identity/PLAN.md) (identity/auth) and M1 (MCP surface).

> Phase: Phase AR1 — shareable artifacts (after ID1, before M2/E2)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Settled spec (owner-grilled 2026-07-11)

- **Model:** external consumers use hosted agents headlessly via MCP; each
  consumer has their own workspace on the deployment and the agent operates
  inside it. MCP consumers see the workspace AS-IS — files are the artifact
  surface. No publish ceremony, no curated registry.
- **Sharing:** the agent returns a link. Minting implicitly records a share
  entry: stable ID → workspace + path + provenance (agent/task, timestamp).
  Live reference semantics — the link always shows current file state.
- **Link = deep link into the web UI:** opens the consumer's own workspace
  focused on that file. This is the bridge from headless MCP consumption into
  the product UI.
- **Broken refs:** resolution is by stable ID; a missing file renders a
  tombstone with provenance + last-known metadata, never a bare 404. Entries
  are re-pointable.
- **Auth:** workspace membership only; login required; no secret in the URL;
  revocation = membership removal; no expiry machinery.
- **Machine access:** the same file is readable via an MCP resource so
  consumer agents read content directly; humans get the URL.
- **Consumer class (owner ruling 2026-07-11, see ID1):** MCP consumers are
  regular users — membership/auth semantics identical to regular users.

## Dependencies

- [ID1](../ID1-agent-identity/PLAN.md) — identity/signin for consumers
  arriving at a deep link (gates AR1).
- M1 (MCP surface) — the consumer-agent ingress this feature serves.
- The workspace contract ([`docs/WORKSPACE_CONTRACT.md`](../../../../../WORKSPACE_CONTRACT.md))
  — deep-link landing and MCP resource access respect workspace authorization.

## Deliverables

- Share-entry store: stable ID → workspace + path + provenance; re-pointable.
- Implicit minting when the agent returns a link (no separate publish step).
- Deep-link route in the web UI: authenticated member lands in their
  workspace focused on the referenced file; tombstone with provenance and
  last-known metadata when the file is missing.
- MCP resource exposing the same file content for machine consumers.

## Exit criteria

- A consumer agent working headlessly via MCP returns a link; a logged-in
  workspace member opens it and lands focused on the current file state.
- A non-member is denied via existing membership auth; no secret in the URL.
- Deleting/moving the file yields a tombstone (provenance + last-known
  metadata), and the entry can be re-pointed.
- The same shared file is readable as an MCP resource by the consumer agent.
