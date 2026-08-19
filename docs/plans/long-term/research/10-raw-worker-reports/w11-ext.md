DIG the EXTENSIBILITY and COMPOSITION models of two agent frameworks, and compare them to an existing
plugin system that is a mature product surface.

ALREADY KNOWN — do not re-report: Flue's 16 hooks and the render-per-turn model; that capabilities may
be conditional and are narrated as signals; eve's filesystem convention (tools/, skills/, connections/,
schedules/, subagents/); that both lack a tenancy model.

TARGETS
A. eve's **extensions** system — `agent/extensions/<mount>.ts`, the directory form, and the
   `<mount>__` prefixed namespace with consumer OVERRIDE semantics (a consumer can place a matching
   file beside the mount to override a contributed tool, or `disableTool()` it). This is the most
   interesting composition idea either framework has and it is barely documented in what we've read.
   Also `defineDynamic(...)` for runtime-resolved capabilities, and eve's `defineHook({events})` model.
   Sources: github.com/vercel/eve docs/extensions.md, docs/guides/hooks.md,
   docs/guides/dynamic-capabilities.md, docs/reference/project-layout.md.
   Fetch with curl -sL "https://r.jina.ai/<url>"; or `npm pack eve@0.31.3` and read the shipped docs/types.
B. Flue's composition seams: custom hooks (composing the built-in hooks), `setProvider`, the
   ToolProvider/`SandboxToolFactory` seam that REPLACES the default model-facing tool set, and how a
   third party would ship a reusable capability bundle. Offline docs from
   /home/ubuntu/projects/spike-flue-celld: npx -y @flue/cli@2.0.3 docs read reference/agent-hooks-api |
   guide/agent-hooks | reference/sandbox-api | reference/provider-api | guide/tools

COMPARE AGAINST OURS (read-only, `git show origin/main:<path>` in /home/ubuntu/projects/boring-ui-v2):
  packages/workspace/docs/PLUGIN_SYSTEM.md and PLUGIN_STRUCTURE.md
  packages/agent/src/server/agent-host/buildAgentComposition.ts   (static tool assembly)
  packages/agent/src/server/agent-host/runtimeCapabilityProjection.ts
  packages/agent/src/server/agent-host/mcpGrants.ts               (default-deny grants)
  plugins/*/                                                       (real first-party plugins)

ANSWER
1. How does a third party contribute a tool/skill/connection in each system, and how are name
   collisions, overrides and disabling handled? Ours vs theirs, concretely.
2. eve's override/namespace model: could it be applied to our plugin system, and what would it give us
   that we lack (e.g. a consumer overriding a vendored plugin's tool without forking it)?
3. Dynamic capabilities: what can change at runtime in each system, at what granularity, and how is the
   model told? Ours is static per binding — what specifically would we gain, and what would break?
4. The trust model: in each system, what can a contributed extension DO, and what stops it? Contrast
   with our default-deny MCP grants and governance-compiled admission. Where are they weaker than us —
   and where, honestly, are they stronger?
5. Anything in either system's composition model that we have NO equivalent for.

OUTPUT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/w11-extensibility.md
Ranked ideas with mechanism + API sketch + what it would cost us + what it would break. Be blunt about
which of our existing decisions (static fleet, trusted-host-plugins-only, authored-data-not-code) each
idea would violate — that matters more than whether the idea is nice.
No preamble. 400-800 lines.
