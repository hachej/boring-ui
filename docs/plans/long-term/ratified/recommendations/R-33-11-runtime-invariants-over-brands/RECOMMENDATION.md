# R-33-11 — Runtime invariants over static checks: retire the phantom scope brand

Status: proposed · Source: DeepSeek `AGENTS.md`, `docs/defensive-patterns.md`
Kind: bug + invariant · Cost: medium · Priority: high

## Claim

`AuthorizedAgentScope`'s brand is a compile-time fiction and must be replaced by a
runtime check at every use site. Adopt DeepSeek's rule: *validate authoritative
event streams or mutable data, not service presence or metadata inspection.*

## Why

The brand emits nothing:

```ts
declare const authorizedAgentScope: unique symbol      // `declare` ⇒ no runtime value
export interface AuthorizedAgentScope {
  readonly [authorizedAgentScope]: true                // type-level only
}
```

Any object shape-matching the two public fields is an `AuthorizedAgentScope` at
runtime. The doc comment on that very interface says it "must be checked by
issuer identity and current membership on every use" — and the type system
cannot enforce that, so it is enforced nowhere.

Where it fails concretely: `embeddedGateway.ts:155` verifies the scope once and
captures the claim in a closure; the subscribe callback never re-verifies. A
membership revocation does not reach an open subscription.

## Evidence

- `packages/agent/src/shared/gateway/types.ts:38-48` — verified present on `main` 2026-08-14.
- `packages/agent/src/server/agent-host/embeddedGateway.ts:155` — single verification, closure capture.
- DeepSeek: *"Runtime Invariants Over Static Checks: the system validates authoritative event streams or mutable data rather than relying on service presence or metadata inspection."*

## What it costs

A verifier call on every scope use rather than at the boundary, plus a membership
epoch on the claim so long-lived subscriptions can be invalidated cheaply. Medium
— the call sites are enumerable but the subscription lifetime change is real work.

## What it breaks

Long-lived subscriptions now terminate on revocation. That is the intended
behaviour and it is currently absent, so it is a behaviour change users can see.

## Refutation

Show that every construction site of `AuthorizedAgentScope` is inside the issuer
module and unreachable from a transport DTO — then the brand is decoration, not a
hole, and only the revocation half of this recommendation stands. That call-site
census is exactly the `research/call-site-traces.md` work still outstanding from
R-33-08, and it is the cheapest way to size this.


## Census result — 2026-08-14, four-agent audit

**The "phantom brand" claim was overstated.** `AgentScopeVerifier` has four
non-test implementations, one per host, all wired (the field is required on
`CreateAgentHostOptions:345`, so no default path exists):

| host | site | check |
| --- | --- | --- |
| CLI hub | `cli/modeApps.ts:62-71` | WeakMap membership + `authSubjectId === 'local'` |
| Standalone | `createStandaloneAgentHostApp.ts:104-111` | WeakSet membership |
| Workspace | `createWorkspaceAgentServer.ts:354-386` | WeakMap + workspaceScopeId equality |
| Core | `createCoreWorkspaceAgentServer.ts:~1307` | WeakMap + real userId claim |

Object-identity verification means a shape-matched object does NOT pass the
verifier — the brand is decorative but the runtime check exists. Revised claims:

1. **Revocation (stands).** `embeddedGateway.ts:155` verifies once into a
   closure. WeakMap membership is process-lifetime; membership revocation never
   invalidates an issued scope object. The membership-epoch fix remains right.
2. **CLI hub scope minting (new, the real finding).**
   `modeApps.ts:956` mints scope from `x-boring-workspace-id` header /
   `?workspaceId=` query — self-asserted, no token check on that path. Defensible
   for a localhost single-user hub (as documented); **any exposure beyond
   localhost (reverse proxy, 0.0.0.0 bind) lets any caller mint any workspace's
   scope.** Mitigation: bind-address assertion + explicit refuse-nonlocal unless
   a real verifier is configured.
3. **Cross-process (stands, matters for remote agents).** Object-identity
   verification cannot cross a process boundary. The remote-agent track requires
   a claim-based (token) scope exchange — WeakMaps do not serialize.
