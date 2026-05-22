# Runtime Plugin Agent Generation Plan — Round 4 Review Synthesis

Reviewed plan: `docs/runtime-plugin-agent-generation-plan.md`

Models consulted in round 4:

- xAI Grok 4.3: `/tmp/runtime_plugin_plan_round4_xai.md`
- Claude Opus 4.7: `/tmp/runtime_plugin_plan_round4_opus.md`
- GPT-5.5 via OpenRouter: `/tmp/runtime_plugin_plan_round4_gpt55.md`

## Verdict

Round 4 reached near steady-state. xAI reported no P0/P1 issues. Opus reported the
plan ready for bead conversion after localized P1 clarifications. GPT-5.5 found
three P1s, all integrated.

## Integrated changes

1. **Hosted iframe isolation baseline**
   - Added isolated origin / opaque sandbox requirement.
   - Added restrictive sandbox/CSP baseline.
   - Forbid host-origin unsandboxed iframe, ambient credentials, wildcard
     `postMessage` trust, top navigation, and unsandboxed popups.

2. **`.boring-agent/` enforceability**
   - Hosted generated tool/RPC/frontend code must not receive writable access to
     `.boring-agent/`.
   - Registry/artifacts are host-owned; tool/RPC exec must see `.boring-agent/`
     absent/read-only or artifacts must be stored outside writable sandbox view.

3. **Portable scaffold default**
   - Default `scaffold-plugin --target auto` creates both native and iframe
     wrappers around shared pane logic.
   - Single-target scaffold is allowed only when verifier/health reports
     non-portability.

4. **`frontMode` authority**
   - Defined `auto | native | iframe` behavior.
   - Hosted always picks iframe for generated/external plugins.
   - Hosted rejects native-only generated plugins with a stable diagnostic.

5. **Registry write authority**
   - Local CLI host is sole writer of `plugin-registry.json`.
   - Hosted core host is sole writer; sandbox build workers only return hashes and
     artifact paths.
   - Locking semantics named for local and hosted.

6. **Capability token details**
   - TTL 10 minutes.
   - Bound to `(workspaceId, pluginId, sessionId, frameId)`.
   - HMR module updates do not rotate token; iframe document reload does.

7. **Runtime support gates**
   - Initial tool handler runtime is `node` only.
   - Python deferred until sandbox image/toolchain is pinned.

8. **Limits table**
   - Added normative limits for tool stdout/stderr, bridge/RPC payload, bridge
     rate, and timeouts.

9. **Phase clarity**
   - Local native phase uses in-memory revision map.
   - Persistent registry lands with hosted stable artifacts.

## Remaining optional nits

- Add exact quarantine thresholds when implementing tests.
- Add `contractVersion` to `plugin-capabilities` output when that command is implemented.
- Decide final `boring.ui.sidebar` naming if/when generated left-tab support is added.
