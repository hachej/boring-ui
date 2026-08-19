DIG opencode v2 as a PEER PRODUCT, not a framework. This is the closest analogue to boring-ui that
exists: a coding agent with a real UI, sessions, plugins, permissions and a server. Flue and eve are
frameworks and make different trades; opencode makes OUR trades. Harvest accordingly.

ALREADY DONE — do not re-report: tool search and Code Mode (bounded catalog, ~2,000-token signature
budget, per-namespace summaries, weighted lexical search over omitted signatures, host-resident
object-tree dispatch, 4,284+ line interpreter, `OPENCODE_EXPERIMENTAL_CODE_MODE` gate).

SOURCES: repo github.com/anomalyco/opencode; docs https://opencode.ai/v2/docs (+ /build, /api).
Fetch: curl -sL --max-time 30 "https://r.jina.ai/<url>"; raw files via
raw.githubusercontent.com/anomalyco/opencode/<branch>/<path>; or `npm pack opencode-ai@latest` and read
the shipped source. State the source for each claim; mark UNVERIFIED where you could not read it.

COVER
1. **Session model.** Storage format and location, resume, branching/forking, sharing, compaction,
   titles, history size limits. How does a session survive a restart? Is there a durability contract at
   all, or is it best-effort persistence?
2. **Permissions.** opencode has a permission/approval system — get its exact shape: what is gated,
   the granularity (tool, path, command pattern), where the decision is made, how it is remembered,
   and whether it is per-session or persistent. Compare to our per-agent default-deny MCP grants and
   #1123 exec grants.
3. **Agent configuration.** `agent` definitions, modes, model selection per agent, prompt overrides,
   tool allow/deny per agent. How does a user compose a specialised agent?
4. **Plugins.** The plugin contract, what a plugin can do, load/trust model, and how plugin tools reach
   the model. Compare to our two-tier plugin system (app/internal vs runtime/generated).
5. **Server/client split.** opencode has a server and multiple clients (TUI, web, IDE). What is the
   wire protocol, how is a session addressed, how do multiple clients on one session behave, and what
   happens on reconnect. This is the closest thing to our AgentGateway — compare directly.
6. **LSP and code intelligence.** What language-server integration exists and what it gives the agent.
   We have none; assess whether it matters for a coding-agent product.
7. **Anything a mature coding-agent product has that we lack** — file watching, diff review UX,
   checkpoint/undo, cost display, model fallback, rate-limit handling, offline behaviour.

COMPARE TO OURS (read-only, `git show origin/main:<path>` in /home/ubuntu/projects/boring-ui-v2):
  packages/agent/src/server/agent-host/**            (gateway, sessions, leases)
  packages/agent/src/server/harness/pi-coding-agent/**
  packages/workspace/docs/PLUGIN_SYSTEM.md
  packages/agent/src/front/**                        (our UI)
Before claiming we lack something, grep for it and cite the search.

OUTPUT to /tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/research/w14-opencode-peer.md
Ranked harvest: idea | mechanism (with file:line) | what it gives us | cost | what it breaks.
Be blunt where opencode is WORSE than us — that is equally useful and stops us copying backwards.
No preamble. 500-1000 lines.
