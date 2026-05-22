# Runtime Plugin Agent Generation Plan — Round 3 Review Synthesis

Reviewed plan: `docs/runtime-plugin-agent-generation-plan.md`

Models consulted in round 3:

- xAI Grok 4.3: `/tmp/runtime_plugin_plan_round3_xai.md`
- Claude Opus 4.7: `/tmp/runtime_plugin_plan_round3_opus.md`
- GPT-5.5 via OpenRouter: `/tmp/runtime_plugin_plan_round3_gpt55.md`

## Integrated round 3 changes

1. **Dual frontend entries**
   - Replaced single `boring.front: "front/index.tsx"` with separate native and
     iframe entries plus optional shared pane module.
   - Rationale: one file cannot cleanly be both a native plugin factory and an
     iframe app mount.

2. **Iframe bridge hardening**
   - Added `sessionId`, `nonce`, token expiration/revocation, response size cap,
     and per-frame rate limit.
   - Clarified `plugin.rpc` is later, not an initial bridge op.

3. **Hosted HMR prerequisites**
   - Added sandbox runtime image/provisioning requirement for Node/Vite/tool
     runtimes.
   - Added authenticated HMR websocket token binding and close conditions.

4. **Runtime-owned `.boring-agent/` and path safety**
   - Added transactional registry updates with lock/atomic rename.
   - Added explicit workspace path contract and `.boring-agent/` access denial.

5. **Tool handler descriptor**
   - Changed generated scaffold default from raw argv command to
     `handler: { runtime, entry }`.
   - Host maps descriptor to local/sandbox exec argv.

6. **Tool/RPC output and permission caveats**
   - Added stdout single-JSON/cap requirement.
   - Added output cap for RPC.
   - Clarified permissions govern host exposure/calls; stricter per-tool FS
     isolation needs mounts or brokered file APIs.

7. **Quarantine behavior**
   - Clarified ordinary user-input validation failures should not quarantine
     plugins.

## Rejected/deferred round 3 suggestions

- Remove hosted live HMR: rejected; it remains the target hosted authoring UX.
- Require perfect state serialization for HMR: rejected; rely on React Fast
  Refresh and document remount limitations.
- Fully enforce declared file globs at OS level in MVP: deferred. The plan now
  states the caveat and future stricter implementation path.
