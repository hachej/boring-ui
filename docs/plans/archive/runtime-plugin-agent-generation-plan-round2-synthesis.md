# Runtime Plugin Agent Generation Plan — Round 2 Review Synthesis

Reviewed plan: `docs/runtime-plugin-agent-generation-plan.md`

Models consulted in round 2:

- xAI Grok 4.3: `/tmp/runtime_plugin_plan_round2_xai.md`
- Claude Opus 4.7: `/tmp/runtime_plugin_plan_round2_opus.md`
- GPT-5.5 via OpenRouter: `/tmp/runtime_plugin_plan_round2_gpt55.md`

## Round 2 consensus

The plan is directionally correct, but reviewers found several gaps to tighten
before bead conversion:

1. **Hosted stable artifacts should land before hosted live HMR.**
   - Live sandbox Vite HMR is the best authoring end-state, but stable artifact
     build/serve defines the registry, rollback, iframe serving, and health model.
   - Integrated by reordering phases: stable artifacts before live HMR.

2. **`.boring-agent/` must be runtime-owned.**
   - It is correct to store artifacts/registry there, but generated plugin code
     must not freely mutate it.
   - Integrated with explicit runtime-owned rules and path validation.

3. **Bridge envelope/security was underspecified.**
   - Added `sessionId`, `nonce`, token expiry/revocation, result size cap, and
     per-frame rate limiting.

4. **Tool declarations should not teach arbitrary shell/argv first.**
   - Integrated `handler: { runtime, entry }` as scaffold default.
   - Host maps handler descriptors to local/sandbox exec argv.
   - Advanced argv can come later behind verifier allowlists.

5. **Permissions need caveats.**
   - Manifest permissions govern host exposure/calls; they do not magically
     restrict arbitrary sandbox filesystem reads unless the sandbox/mounts enforce
     that.
   - Integrated permission caveat and future narrower mounts/brokered file APIs.

6. **Need dependency policy.**
   - Local CLI may use Vite/workspace deps.
   - Hosted deps install/build only inside sandbox/build runtime.
   - Marketplace later needs lockfile/provenance/integrity.

7. **Need lifecycle/quarantine and stable error codes.**
   - Added lifecycle states, quarantine triggers, and initial error-code families.

8. **Need naming/collision rules.**
   - Added plugin id/contribution id/tool collision rules.

9. **Need portable frontend SDK distinction.**
   - Native mode uses `@hachej/boring-workspace/plugin`.
   - Iframe mode uses future `@hachej/boring-workspace/iframe-plugin` bridge SDK.

## Suggestions intentionally not fully adopted

- **Remove hosted live HMR entirely.** Rejected. Julien identified hosted live-dev
  HMR as the best authoring solution. We kept it, but made stable artifacts land
  first.
- **Remove `plugin-capabilities` command.** Not adopted yet. The command remains
  useful for agent generation contracts, though it can be implemented late.
- **Move artifacts outside `.boring-agent/`.** Rejected for now because PR/runtime
  direction already treats `.boring-agent/` as runtime-owned tooling/state.
  Instead, the plan now makes `.boring-agent/` protected/runtime-owned.
- **Jump directly to MCP.** Rejected for MVP. Command proxy remains the simple
  first tool runtime; MCP remains a later upgrade.

## Integrated files

- `docs/runtime-plugin-agent-generation-plan.md`
