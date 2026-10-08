# Self-evolution: agents that write their own instructions, skills and tools

Status: implemented 2026-10-06 in `@hachej/boring-agent` (`defineAgent({ selfEvolving: true, workspace })`, the `reload` tool, instructions,
skills and tools from `.agent/`, the scan on open, the `npm run check` rule) and turned on for the studio's local (virtual) variant, with its
`/reload` command, and the Cloudflare recipe (agent `reload` only); proved by the studio journey `self-evolution`. The laws now live in
[packages/agent/README.md](../../packages/agent/README.md#self-evolution). Not done: the factory promotion workflow (see Apps). Owner decisions recorded here: the agent writes its
own tools; the library stays close to native Pi; isolation belongs to where `exec` runs (the host's `ExecutionEnv`, and
later the dedicated runtime in boring-factory), not to a new Boring layer.

## In one paragraph

`defineAgent({ …, selfEvolving: true })` lets an agent keep and change its own standing instructions, skills and tools in
an `.agent/` folder of its workspace, then call a `reload` tool to apply them. Instructions and skills are text. Tools are
scripts that run through the conversation's own `ExecutionEnv`, the same place and isolation as the agent's `bash`; the
host process never imports agent-written code. Off by default: without the option the agent is plain native Pi.

## The folder

```
.agent/
  AGENTS.md        standing instructions the agent writes for itself
  skills/*.md      skills, in the existing skill format (parseSkill), loadable with load_skill or /<skill>
  tools/<name>.json  a tool description: { name, description, parameters (JSON Schema), run } where `run` is the command
                     executed in the workspace (for example `node .agent/tools/csv-stats.mjs`), arguments passed as JSON on stdin
```

## How each part works (all native Pi)

- **Instructions**: a native prompt section renders `.agent/AGENTS.md` on every request, after the host's base prompt and
  clearly labelled as agent-written. The host's base prompt stays first and is never replaced.
- **Skills**: the existing skills extension also reads `.agent/skills/`.
- **One extension per workspace.** Instructions, skills, tools and `reload` live in one native extension named per workspace
  (`self-evolving:<workspace instance id>`), so two workspaces in one host never replace each other's tools.
- **Tools**: each description becomes a native `ToolRegistration` in that extension; its `execute`
  runs `run` through the conversation's `ExecutionEnv` (`exec`), with the arguments on stdin and the output as the result.
- **Reload**: a `reload` tool (and the `/reload` command for the person, same function) rescans `.agent/`, then calls the
  native `registry.install()` (same name replaces in place) / `registry.uninstall()`, and returns a summary: tools
  added/changed/removed, skills, instructions, and every load error (invalid JSON, missing script, schema error). A tool
  call already running finishes on its old version; the next step uses the new one (native Pi behaviour). Pi exposes no
  reload tool to the model by default; this is the only addition, and it calls the native host API.
- **Persistence and history**: the files live in the workspace, so they survive restarts (the host reinstalls on open by
  running the same scan) and every change is versioned by the workspace (git where present). Rollback is restoring files
  and reloading.

## Isolation follows `exec`

| The variant's `exec` runs in… | Agent-written tools run in… |
| --- | --- |
| the virtual just-bash workspace | the same virtual workspace (shell; JavaScript through code mode's sandbox) |
| a remote sandbox (Vercel, Cloudflare) | that sandbox, with no host secrets |
| the in-browser agent worker (BORING-PI-5 opt-in) | the person's browser |
| a native local environment | the local machine, with the rights of that process, as Pi on a laptop |

- **One provider.** `reload` reads `.agent/` through the conversation's own `FileSystem`, from the same provider instance as its
  `exec` (the one-provider rule in `AGENTS.md`), never the host's disk. With a remote sandbox, the description, the script
  and its execution all stay in the sandbox; the host only registers the native tool from the description it read.
- **Persistence follows the environment.** `.agent/` lives as long as that workspace. Where the environment does not persist
  (an expiring sandbox), version `.agent/` with the workspace (git push or a published resource) or it is lost with it.
- **No `exec`, no tools.** On an environment without `exec` (for example today's Cloudflare recipe), instructions and skills
  still work and `reload` reports that tools are unavailable there instead of registering tools that cannot run.
- **Cost.** Every call to an agent-written tool is one `exec` round trip on that environment.

No separate trust setting. Choosing the execution environment chooses the isolation. Hosts that want a person to approve
changes to `.agent/` use the existing approval gate; it is not part of this feature.

## Apps

In a production app, agent-written improvements are promoted, not loaded live: the agent (or the factory workflow)
opens a pull request on the app's repository, where review, tests and release turn them into ordinary trusted code.
Live self-evolution is for development, demos, personal and sandboxed agents. That workflow belongs to boring-factory.

## Laws

SELF-1..4 (opt-in; never imported into the host; host prompt first; native, honest reload) moved beside their package owner,
[packages/agent/README.md](../../packages/agent/README.md#self-evolution), with their evidence in `VERIFY.json` `features`, keeping these IDs.

## Changes elsewhere (done)

- `AGENTS.md`: the line "generated content is never native executable plugin code" becomes: agent-written code is never
  imported into host processes; it may run only through the conversation's `ExecutionEnv` under this document.
- `docs/LAWS.md`: index entry for SELF-1..4.
