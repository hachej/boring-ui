ADVERSARIAL REVIEW of the POLICY AND GOVERNANCE system — the part of this product claimed as its
differentiator. Five independent reviewers have failed to break it. Break it.

CODEBASE: /home/ubuntu/projects/boring-ui-v2 at `origin/main` (`git show origin/main:<path>`).

SURFACE
  docs/DECISIONS.md — D25/D26/D28 (authored data is never executable; static fleet; governance-compiled
    Environment admission; agents receive operations/capabilities, not policy sources), D29
    (`AuthorizedAgentScope` is an issuer-owned runtime capability, branded, re-checked on every use,
    never a transport DTO; single construction funnel with a CI invariant)
  packages/agent/src/server/agent-host/createAgentHost.ts       — scope minting, verify(), bindings
  packages/agent/src/server/agent-host/runtimeCapabilityProjection.ts
  packages/agent/src/server/agent-host/mcpGrants.ts             — default-deny, exact-match allowlist
  packages/agent/src/server/agent-host/environmentHttpProjection.ts  — scope minted per request
  packages/agent/src/server/agent-host/environmentLease.ts
  plugins/boring-governance/**
  packages/agent/src/server/http/routes/skills.ts + skill access policy
  docs/issues/1123/plan.md — exec grants, mount sets, lease keyed by resolved mount set

ATTACK
1. **The branded scope.** D29 says it "cannot be forged by spreading an object across a boundary".
   TEST that claim against the code: is the brand a TypeScript-only `unique symbol` (erased at runtime)
   or an actual runtime guard? Can a plain object satisfy `verify()`? Can a scope be captured from one
   request and reused in another? **A TypeScript-only brand is a compile-time comment, not a control.**
2. **The CI invariant.** Find the rule that forbids constructing a gateway outside `createAgentHost()`.
   Read it. Does it actually detect a bypass — a re-export, a dynamic import, a test helper promoted to
   production, a plugin doing it? Try to defeat it on paper.
3. **"Re-checked on every use".** Enumerate the operations that take a scope and verify EACH re-checks
   issuer identity and current membership. Find one that checks at connection time only, then serves
   many operations. Long-lived streams and leases are the likely holes.
4. **Structural vs advisory.** The claim is that grant enforcement is structural because resource
   identity differs per grant set. This session already found that a schema's "structural" invariants
   were adapter-only until mutation-tested. Apply the same test on paper: if the enforcement code were
   deleted, what still stops the bad access? If the answer is "nothing", it is advisory.
5. **Authored-data-not-code.** Find any path where authored/config data influences executable
   selection: a plugin id that resolves to a package, a skill path that becomes an import, a tool name
   that selects a handler, a model id that picks a provider module.
6. **Governance-compiled admission.** Trace how governance turns an authorized invocation into
   attenuated Environment admission. Where is attenuation ACTUALLY applied — at admission, or trusted to
   the caller? Can a broader capability be derived from a narrower one?
7. **Revocation.** Membership removed, grant revoked, workspace deleted mid-session: how long does
   in-flight authority survive? Name the bound, or state there is none.
8. **The seams nobody looks at**: test helpers, dev/standalone modes, `agent dev`, the playgrounds, and
   any `skipAuth`/`allowInsecure` flag. Production controls are usually bypassed in the dev path.

OUTPUT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/c5-governance-attack.md
Per finding: severity, the bypass with file:line, and whether the control is STRUCTURAL, ENFORCED-BY-CODE
or CONVENTION-ONLY. That classification is the deliverable — we have been telling ourselves "structural"
and have been wrong before. End with a blunt verdict on whether the differentiator claim survives.
No preamble. 500-900 lines.
