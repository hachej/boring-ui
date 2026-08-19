DEFENSIVE VERIFICATION AUDIT of our own authorization controls. This is a first-party code review of
the repository we own, checking whether documented security guarantees are actually implemented. The
deliverable is a classification, not an exploit: for each control, is it STRUCTURAL, ENFORCED-BY-CODE,
or CONVENTION-ONLY?

Context for why this matters: a sibling audit just found that Decision 27 (workspace BYOK credential
custody) is ratified policy whose production architecture is NOT implemented — the workspace key is
never consulted on the live model path. We need to know whether the same gap exists in the
authorization layer before we keep describing it as a differentiator.

CODEBASE: /home/ubuntu/projects/boring-ui-v2, read from `origin/main` (`git show origin/main:<path>`).

DOCUMENTED GUARANTEES TO VERIFY (docs/DECISIONS.md)
  D29: `AuthorizedAgentScope` is "an issuer-owned runtime capability, not a transport DTO", carries a
       `unique symbol` brand so it "cannot be forged by spreading an object across a boundary", and
       "must be re-checked against issuer identity and current membership on every use — possession is
       not authorization". `createAgentHost()` is the single construction funnel, protected by a CI
       invariant.
  D28: agents receive operations/capabilities, not policy sources; governance plugins compile
       authorized invocation context into attenuated Environment admission.
  D25/D26: authored agent data is declarative only and never selects executable packages, tools,
       credentials, MCP commands, models, or runtime policy.
  #1123: exec grants enforced structurally because resolved mount set is part of lease identity.

CODE
  packages/agent/src/server/agent-host/createAgentHost.ts, runtimeCapabilityProjection.ts,
    mcpGrants.ts, environmentHttpProjection.ts, environmentLease.ts, httpProjection.ts
  packages/agent/src/shared/gateway/types.ts
  plugins/boring-governance/**, packages/agent/src/server/http/routes/skills.ts
  the CI invariant that guards the construction funnel (find it)

VERIFY, WITH FILE:LINE EVIDENCE
1. Is the scope brand a runtime-checkable value or a TypeScript-only type? Read `verify()`. Would a
   plain object of the right shape be accepted at runtime? (A `unique symbol` is erased at compile
   time; if nothing else guards it, the control is CONVENTION-ONLY and the docs overstate it.)
2. Does every scope-consuming operation re-check issuer identity and current membership, or do some
   check once at connection/lease time and then serve many operations? Enumerate them and mark which.
3. Locate the CI invariant. Does it detect construction outside the funnel via re-export, dynamic
   import, or a test helper imported by production code? State what it does and does not catch.
4. Apply the deletion test to grant enforcement: if the enforcement function were removed, what else
   would still prevent the access? If nothing, the control is enforced-by-code, not structural — that
   is a legitimate and common answer, we simply need the truth.
5. Is there any path where authored/config data selects executable behaviour (plugin id -> package,
   skill path -> import, tool name -> handler, model id -> provider module)?
6. Where is Environment attenuation actually applied — at admission, or trusted to the caller?
7. After membership removal or grant revocation, how long can in-flight authority persist? State the
   bound or state that there is none.
8. Do development/standalone/playground paths or any `skipAuth`-style option relax these controls, and
   can such a path be reached in a production build?

OUTPUT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/c5-governance-audit.md
A table: control | documented guarantee | actual implementation (file:line) | classification
(STRUCTURAL / ENFORCED-BY-CODE / CONVENTION-ONLY) | gap. Then the remediation list, ordered.
Where a guarantee genuinely holds, say so clearly — a verified control is as valuable a finding as a gap.
No preamble. 500-900 lines.
