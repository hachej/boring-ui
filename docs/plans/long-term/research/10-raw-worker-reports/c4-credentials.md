ADVERSARIAL SECURITY REVIEW of CREDENTIAL MANAGEMENT. Assume an attacker and assume mistakes. Find
where a secret leaks, is over-shared, outlives its authority, or reaches the model.

CODEBASE: /home/ubuntu/projects/boring-ui-v2 at `origin/main` (`git show origin/main:<path>`).

SURFACE
  docs/DECISIONS.md — Decision 27 (Workspace BYOK): encrypted `workspace_settings`,
    `WORKSPACE_SETTINGS_ENCRYPTION_KEY`, membership-before-resolution, invocation-scoped
    `ModelCapabilityIssuer`, explicit instance-key fallback, fail-closed on unreadable key
  packages/core/**            — workspace settings storage/encryption, membership
  packages/agent/src/server/agent-host/mcpGrants.ts, mcpGrantStore.ts   — connector auth
  packages/agent/src/server/agent-host/runtimeCapabilityProjection.ts
  packages/agent/src/server/models/**, http/routes/models.ts
  pi's auth store `~/.pi/agent/auth.json` and the adapter that reads it
  packages/agent/src/server/harness/pi-coding-agent/**   — what env reaches the harness
  plugins/boring-mcp/**       — connector credentials at the call boundary
  packages/boring-sandbox/**  — what environment/env vars enter a sandbox

ATTACK, and trace each to code
1. **Does a credential ever reach the model?** Tool arguments, tool RESULTS, error messages, logs,
   telemetry, prompt text, MCP tool output, sandbox env visible to `bash`/`env`. D27 says keys are never
   written to sessions/tasks/events/logs/filesystems — VERIFY that, do not assume it.
2. **Sandbox environment.** Exactly which env vars are present inside bwrap/runsc/direct? Can an agent
   run `env` and see a provider key, a workspace settings key, or a connector token? Quote the code that
   builds the sandbox environment.
3. **Invocation scoping.** D27 requires an opaque per-invocation model client that a cached
   AgentApplication cannot capture. Find where the capability is minted and whether anything long-lived
   closes over it. A captured reusable credential is a FATAL finding.
4. **Encryption at rest.** How is `WORKSPACE_SETTINGS_ENCRYPTION_KEY` supplied, rotated and revoked?
   What happens when it is missing, wrong, or changed — is it fail-closed as claimed? Is the ciphertext
   authenticated (AEAD) or malleable? Is the same key used for every workspace?
5. **The instance fallback.** D27 permits falling back to an instance `ANTHROPIC_API_KEY` when a
   workspace has no BYOK. Construct the case where tenant A's work is silently billed to the instance
   key, or where the fallback fires when it should have failed closed.
6. **MCP connector auth.** Where do connector tokens live, who can read them, and can an agent in
   workspace A cause a call using workspace B's connected account? Check the grant resolution AND the
   execution path — they may differ.
7. **pi's auth store.** It is a shared file outside our control. Multi-tenant hosting reading a
   single `~/.pi/agent/auth.json`: whose credentials are those, and what stops cross-tenant use?
8. **Rotation and revocation.** After a key is revoked or rotated, how long can an in-flight or cached
   capability keep working? Is there any bound?
9. **Secrets in output.** If a tool prints a secret (env dump, curl -v, a config file read), what
   scrubs it before context, logs, traces and the durable transcript? A prior review found NO framework
   solves this — establish exactly what WE do.

OUTPUT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/c4-credentials-attack.md
Per finding: severity, the exact leak/abuse path with file:line, exploitability (who needs what
access), and the fix. Separate DESIGN gaps from IMPLEMENTATION bugs. State plainly where D27's claims
hold — a verified control is as valuable as a hole.
No preamble. 400-900 lines.
