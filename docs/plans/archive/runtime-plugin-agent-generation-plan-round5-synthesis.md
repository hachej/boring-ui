# Runtime Plugin Agent Generation Plan — Round 5 Final Review Synthesis

Reviewed plan: `docs/runtime-plugin-agent-generation-plan.md`

Models consulted in round 5:

- xAI Grok 4.3: `/tmp/runtime_plugin_plan_round5_xai.md`
- Claude Opus 4.7: `/tmp/runtime_plugin_plan_round5_opus.md`
- GPT-5.5 via OpenRouter: `/tmp/runtime_plugin_plan_round5_gpt55.md`

## Verdict

After integrating round 5 P1 feedback, the plan is bead-ready.

- xAI: BEAD-READY, optional nits only.
- Opus: BEAD-READY, optional nits only.
- GPT-5.5: no P0s; two hosted permission/isolation P1s and one scaffold portability P1. These were integrated.

## Integrated round 5 changes

1. **Hosted permission-scoped exec envelope**
   - Hosted generated tool/RPC execution must not receive broad workspace read/write/network access by default.
   - File visibility/writability is limited to declared permission globs.
   - Network egress is default-deny unless enforceable allowlist exists.
   - If the envelope is unavailable, hosted generated tool/RPC operations requiring file/network access are disabled with `PLUGIN_CAPABILITY_DENIED`.

2. **`.boring-agent/` enforceability**
   - Hosted generated tool/RPC/frontend code must not receive writable access to `.boring-agent/`.
   - Tool/RPC acceptance criteria now require this.

3. **Portable default scaffold**
   - `--target auto` creates both native and iframe wrappers around shared pane logic.
   - Single-target scaffold is allowed only with non-portability diagnostic.

4. **Iframe isolation baseline**
   - Hosted iframe content must not be same-origin unsandboxed with host app.
   - Added isolated origin/opaque sandbox, no ambient credentials, restrictive CSP, strict source/origin checks.

5. **Token/limit details**
   - Added `PLUGIN_BRIDGE_DENIED` subcodes.
   - Added normative size/rate/time limits.
   - Added token bucket wording for bridge rate limits.
   - Added `pi.systemPrompt` prompt budget caps.

6. **Agent capability fallback**
   - If `plugin-capabilities` command does not exist, agent assumes conservative portable defaults and scaffolds `--target auto`.

7. **Quarantine recovery**
   - Recovery requires explicit user action plus successful re-verify; no auto-recovery.

## Remaining optional implementation details

- Pick exact quarantine thresholds during test bead creation.
- Decide final sidebar manifest naming if generated left tabs become supported.
- Add precise hosted lock TTL when implementing DB/Redis advisory lock.
