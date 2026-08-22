You are completing a technical analysis of the Flue agent framework (v2.0.3, withastro/flue).

TOOLING: Flue's full docs are bundled with its CLI and available OFFLINE. From the directory
/home/ubuntu/projects/spike-flue-celld run:
    npx -y @flue/cli@2.0.3 docs            # lists all 95 pages
    npx -y @flue/cli@2.0.3 docs read <path>  # prints one page as markdown
Use these. Do not guess; quote from the pages.

ALREADY ANALYSED (do NOT re-cover, only note contradictions you find):
guide/skills, guide/mcp, guide/subagents, guide/durability, guide/schedules, guide/workflows,
guide/getting-started, guide/tools, guide/observability, guide/evals,
reference/agent-hooks-api (hook list), reference/agent-behavior (built-in tools, context composition,
compaction), reference/streaming-protocol, reference/data-persistence-api, reference/sandbox-api,
reference/provider-api, sdk/flue-client (part shapes).

YOUR SCOPE - read these in full and report:
guide/building-agents, guide/agent-hooks, guide/routing, guide/channels, guide/database,
guide/react, guide/project-layout, guide/deploy, guide/models, guide/node-target,
guide/cloudflare-target, guide/why-flue, guide/migration,
reference/agent-api, reference/events, reference/errors, reference/configuration,
sdk/overview, sdk/create-flue-client, sdk/events, sdk/errors,
cli/overview, cli/run, cli/init, cli/add, cli/update,
and skim ecosystem/tooling/* (braintrust, opentelemetry, sentry, jetty, vitest-evals).

OUTPUT: write a dense technical report to
/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/r1-flue.md

Structure it as:
1. Per-page findings: for each page, the 2-5 load-bearing facts. Exact API signatures, exact
   defaults/limits/numbers, exact error codes, exact route shapes. Quote sparingly but precisely.
2. The agent lifecycle end to end: what happens from `dispatch()` / HTTP POST through render,
   turn loop, settlement. Name the functions and the records written.
3. `reference/events`: the COMPLETE event vocabulary as a table (event type -> when emitted -> payload fields).
4. `reference/errors`: the COMPLETE error type list and the HTTP envelope shape.
5. `reference/agent-api`: agent statics (durability, agentName, etc), dispatch(), init(), harness.*,
   dynamic resources / signals mechanism - exact semantics.
6. Routing: what createAgentRouter mounts, how auth/CORS are expected to be layered, dispatch-only agents.
7. Anything that CONTRADICTS or refines these prior conclusions:
   - "Flue has no scheduler of its own"
   - "workflows are not a Flue feature per se"
   - the protocol is state-based and never exposes deltas
   - channel packages peer-depend on @flue/runtime
8. A final section: "10 mechanisms most worth copying", each one sentence, most valuable first.

Be terse and factual. No preamble, no praise, no summary of what you are about to do. Dense bullet
points and tables. Target 800-1500 lines of markdown. Accuracy over completeness where they conflict.
