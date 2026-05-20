# Plan: unified agent workspace runtime

## Status

Planning only. No implementation in this PR.

Goal: make the agent run commands from the same root it sees in the file tree, with SDKs and CLIs available consistently across `direct`, `local`/bwrap, and `vercel-sandbox` modes.

## Core invariant

```txt
file tree root == shell cwd == model-visible cwd == BORING_AGENT_WORKSPACE_ROOT
```

The agent should only need to know:

```txt
Shell cwd: <runtimeCwd>. Use relative paths and PATH commands. Do not cd to host/server paths.
```

Everything else is runtime/tool responsibility.

## Runtime context

Keep the shared contract tiny:

```ts
interface WorkspaceRuntimeContext {
  /** File-tree root and command cwd visible to the agent. */
  runtimeCwd: string
}
```

Mode values:

```txt
direct:
  runtimeCwd = /real/host/workspace/<id>

local/bwrap:
  runtimeCwd = /workspace

vercel-sandbox:
  runtimeCwd = /workspace
```

Host bind sources, remote roots, and storage paths are adapter-private details.

## Workspace and Sandbox contract

Decision: the public `Workspace` root exposed to tools/agent is the agent-visible file-tree root.

```ts
interface Workspace {
  root: string // same value as runtimeContext.runtimeCwd
  runtimeContext: WorkspaceRuntimeContext
}

interface Sandbox {
  runtimeContext: WorkspaceRuntimeContext
  exec(command, opts?) // defaults cwd to runtimeContext.runtimeCwd
}
```

Required invariant:

```txt
Workspace.root === Workspace.runtimeContext.runtimeCwd
Workspace.runtimeContext.runtimeCwd === Sandbox.runtimeContext.runtimeCwd
```

Implementation note: adapters may keep private storage roots internally.

- `direct`: public root and storage root are the same host path.
- `local`/bwrap: public root is `/workspace`; adapter privately knows host bind source.
- `vercel-sandbox`: public root is `/workspace`; adapter privately knows `/vercel/sandbox`.

Generic agent code must not maintain separate “file root” and “shell root” concepts.

## Exec contract

`Sandbox.exec` cwd is in the agent/runtime namespace.

Rules:

- default cwd is `runtimeCwd`
- explicit cwd, if accepted, is runtime-visible or relative to `runtimeCwd`
- adapter translates structured cwd internally if needed
- **never rewrite arbitrary command strings**

Examples:

```txt
direct:         process cwd = /real/host/workspace/<id>
local/bwrap:    bwrap --chdir /workspace
vercel-sandbox: runCommand cwd = /workspace
```

No code should do:

```ts
cmd.replaceAll('/workspace', '/vercel/sandbox')
```

If structured file APIs need storage paths, adapters handle that internally.

## Vercel decision

Vercel is included.

Target behavior:

```txt
pwd == /workspace
$PWD == /workspace
BORING_AGENT_WORKSPACE_ROOT == /workspace
normal command output does not expose /vercel/sandbox
```

Implementation direction:

- Vercel `runCommand` supports `cwd`.
- During sandbox init, ensure `/workspace` exists as the agent-visible workspace root, preferably by creating a symlink/alias to the Vercel storage root.
- Run commands with `cwd: '/workspace'`.
- Remove current command/env string rewriting from `createVercelSandboxExec.ts`.
- Keep `/vercel/sandbox` inside Vercel file API internals only.

If a spike proves `/workspace` cannot be made real, stop and redesign explicitly. Do not silently fall back to command-string rewriting.

## Prompt/session cwd

Use the existing Pi/session cwd mechanism, but supply `runtimeCwd`.

Do not append a second conflicting cwd line. The base cwd line should already be correct.

Optional wording if needed:

```txt
Shell cwd: <runtimeCwd>. Use relative paths and PATH commands. Do not cd to host/server paths.
```

## Standard SDK / CLI provisioning contract

There should be one unified way to add SDKs and CLIs to the agent runtime:

```txt
RuntimeProvisioningContribution
  templateDirs[]   -> skills/docs/seed files
  python[]         -> Python SDKs installed into .boring-agent/venv; console scripts on PATH
  nodePackages[]   -> Node/standalone CLIs, e.g. @hachej/boring-ui-cli
```

Agent-owned runtime artifacts live under one directory:

```txt
<runtimeCwd>/.boring-agent/
  bin/       # command shims / linked CLI bins
  node/      # Node CLI package installs
  venv/      # Python SDK/tool venv
  sdk/       # copied/local SDK sources
  state/     # provisioning fingerprints, manifests, ownership markers
  cache/     # runtime-local npm/pip/uv caches; safe to delete
  tmp/       # atomic provisioning staging
  logs/      # provisioning/runtime doctor logs
```

Runtime exposes these on PATH:

```txt
<runtimeCwd>/.boring-agent/bin
<runtimeCwd>/.boring-agent/venv/bin
```

Rules:

- Python SDKs belong in `python[]`.
- Node/CLI packages belong in `nodePackages[]`.
- `templateDirs[]` is for files/skills/docs/seeds, not app-specific installer logic.
- Shims are thin wrappers only for stable aliases or shebang normalization.
- Shims must not lazy-provision, hide broken `.boring-agent/venv`, or encode app-specific path/API defaults.

### `nodePackages[]` minimal shape

If not already implemented, add:

```ts
interface RuntimeNodePackageSpec {
  id: string
  packageName: string
  version?: string
  /** Local package source. For remote runtimes, pack then install the tarball. */
  packageRoot?: string
  /** Optional bin allowlist/aliases: exposedName -> package bin name/path. */
  bins?: Record<string, string>
}
```

Pragmatic install strategy:

- install packages into `<runtimeCwd>/.boring-agent/node`
- keep npm/pnpm cache under `<runtimeCwd>/.boring-agent/cache/node` when practical
- stage package/tarball work under `<runtimeCwd>/.boring-agent/tmp`
- use npm/pnpm internally; do not build a custom package manager
- for `packageRoot`, pack the local package and install the tarball so remote runtimes work too
- link requested package bins into `<runtimeCwd>/.boring-agent/bin`
- duplicate bin names fail unless explicitly aliased with `bins`
- include package spec, package.json, lockfile/tarball hash, and bins in provisioning fingerprint

Default `boring-ui` CLI:

- workspace default provisioning contributes `@hachej/boring-ui-cli`
- contribution id: `boring-ui-cli-package`
- exposed bin: `boring-ui`
- available in all modes where plugin authoring/scaffold tooling is enabled, including local mode
- can be excluded later through existing default/exclude mechanisms if needed

## Runtime-aware provisioning

Provisioning must run against the runtime that will execute the tools.

Current problem: some provisioning runs before runtime creation against a host workspace root. That cannot work for Vercel.

Required change:

- create/resolve runtime bundle first, or introduce a runtime-aware provisioning target
- provisioning receives `Workspace`, `Sandbox`, and `runtimeCwd`
- direct/local may still use host-side filesystem when safe
- Vercel provisioning runs inside the remote sandbox with cwd `/workspace`

## Python provisioning

Make the agent-owned venv valid in the runtime that will execute it.

Direct:

- host smoke check is enough.

local/bwrap:

- create the agent-owned venv at `.boring-agent/venv`, not top-level `.venv`
- avoid `uv venv .boring-agent/venv` if it creates interpreter symlinks outside mounted roots
- prefer:

  ```bash
  python3 -m venv --copies .boring-agent/venv
  ```

- use `uv pip install --python .boring-agent/venv/bin/python ...` for package speed if available
- smoke check inside bwrap:

  ```bash
  /workspace/.boring-agent/venv/bin/python -c 'import sys; print(sys.executable)'
  ```

Vercel:

- seed source/template files into sandbox
- ensure `/workspace` exists
- run Python provisioning inside the sandbox with cwd `/workspace`
- smoke check remotely
- use Vercel persistence/snapshots for cache

Broken venv repair:

1. create temp venv under `.boring-agent/tmp/venv-*`
2. install SDK packages, using `.boring-agent/cache/python` when practical
3. smoke check in target runtime
4. replace `.boring-agent/venv` safely
5. do not mark runtime materialized on failure

Migration:

- new runtimes use `.boring-agent/venv`
- provisioning state moves to `.boring-agent/state/provisioning.json`
- keep a backward-compatible read of old `.boring-agent/provisioning.json` during migration
- old top-level `.venv` is ignored for agent runtime tools
- remove old top-level `.venv` only when ownership markers prove the agent created it
- bump provisioning version so old broken venvs are rebuilt under `.boring-agent/venv`

## bwrap parent overlay fix

Current parent global tool mounts can shadow child `.boring-agent` runtime files.

Fix:

- workspace-specific runtime files win
- only mount parent runtime dirs if child workspace does not have its own dir
- do not shadow child `.boring-agent`, including `.boring-agent/venv`

## MacroAnalyst cleanup

Once canonical provisioning works, remove MacroAnalyst-specific duplicate SDK/shim code.

Remove or retire:

- `src/server/macroSandboxTemplate.ts` if only used for SDK/shim generation
- manual SDK copy into `.boring-agent/sdk/boring-macro-sdk`
- hand-written `bm`, `python`, `python3`, `pip`, `pip3` shims
- `templatePath` plumbing that exists only for those shims

Keep real app-specific files by moving them into `macroProvisioning.templateDirs`.

Do **not** remove generic/default CLI provisioning such as `@hachej/boring-ui-cli`.

## Diagnostics and guardrails

Add runtime doctor/smoke data:

- `runtimeCwd`
- PATH first entries
- `BORING_AGENT_WORKSPACE_ROOT`
- `VIRTUAL_ENV`
- agent artifact roots (`.boring-agent/bin`, `.boring-agent/node`, `.boring-agent/venv`, `.boring-agent/state`, `.boring-agent/cache`, `.boring-agent/tmp`)
- python executable status
- provisioning fingerprint/version

Do not expose secrets.

Add dev/test-only leak detector for sandboxed modes:

- fail if host workspace root appears in model-facing prompt/observations
- fail if `/vercel/sandbox` appears in Vercel model-facing prompt/observations

## Tests

### Unit tests

- each adapter returns correct `runtimeContext.runtimeCwd`
- `Workspace.root === runtimeContext.runtimeCwd`
- `Workspace` and `Sandbox` share the same `runtimeCwd`
- `Sandbox.exec` default cwd is runtime namespace
- bwrap cwd handling accepts runtime namespace and translates internally
- Vercel exec does not rewrite command strings or env strings
- Vercel exec runs `pwd` as `/workspace`
- env roots use `runtimeCwd`, not parent env
- PATH prefixes use `<runtimeCwd>/.boring-agent/bin` and `<runtimeCwd>/.boring-agent/venv/bin`
- plugin PATH additions merge after core prefixes
- reserved env overrides are rejected
- HTTP URL env values stringify correctly; `file:` URLs become file paths
- bwrap parent `.boring-agent` does not shadow child runtime files
- old top-level `.venv` is not used for agent runtime tools
- `nodePackages[]` validates, fingerprints, installs, links bins, and detects bin collisions
- provisioning state is written to `.boring-agent/state/provisioning.json`
- temp provisioning work happens under `.boring-agent/tmp`
- caches stay under `.boring-agent/cache` when practical

### Matrix integration suite

Run the same fixture across:

- `direct`
- `local`/bwrap
- `vercel-sandbox`

Fixture command:

```bash
pwd
echo $PWD
echo $BORING_AGENT_WORKSPACE_ROOT
echo $VIRTUAL_ENV
which python
which pip
python -c 'import sys; print(sys.executable)'
<python-console-script> --help
boring-ui --help
```

Assert:

- `pwd === runtimeCwd`
- `$PWD === runtimeCwd`
- model-visible cwd equals file tree root
- sandboxed modes do not expose host path
- Vercel does not expose `/vercel/sandbox`
- Python and CLI tools work from PATH
- literal command strings are not rewritten

### MacroAnalyst regression

Fixture plugin shape:

- template dir with skills/docs
- Python SDK with console script `bm`
- optional Node CLI package

Assert:

```bash
bm list
bm run --tool builtin:yoy --input FYOIGDA188S --output FYOIGDA188S_YOY2 --title "FYOIGDA188S YoY 2"
```

works from initial cwd with no prefixes or host paths.

## Detailed implementation TODO

### Track A — runtime cwd contract

- [ ] Add `WorkspaceRuntimeContext { runtimeCwd }` to runtime bundle types.
- [ ] Make `Workspace.root` the agent-visible file tree root.
- [ ] Add/verify invariant: `Workspace.root === Workspace.runtimeContext.runtimeCwd`.
- [ ] Add/verify invariant: `Workspace.runtimeContext.runtimeCwd === Sandbox.runtimeContext.runtimeCwd`.
- [ ] Update `direct` adapter: `runtimeCwd = host workspace path`.
- [ ] Update `local`/bwrap adapter: `runtimeCwd = /workspace`.
- [ ] Update `vercel-sandbox` adapter: `runtimeCwd = /workspace`.
- [ ] Update exec/bash tool wiring so default command cwd is runtime namespace.
- [ ] Ensure host/internal storage paths stay adapter-private.

### Track B — prompt/session cwd

- [ ] Find all Pi/session cwd call sites.
- [ ] Pass `runtimeCwd` to the existing Pi cwd/session mechanism.
- [ ] Remove or avoid any second conflicting cwd prompt line.
- [ ] Add one optional short line only if needed: `Shell cwd: <runtimeCwd>. Use relative paths and PATH commands. Do not cd to host/server paths.`
- [ ] Add tests that model-visible cwd equals `runtimeCwd`.
- [ ] Add dev/test leak detector for sandboxed modes.

### Track C — Vercel `/workspace` behavior

- [ ] Spike whether `/workspace` can be real via symlink/alias to Vercel storage root.
- [ ] Ensure Vercel `runCommand` uses `cwd: /workspace`.
- [ ] Remove command-string rewriting in `createVercelSandboxExec.ts`.
- [ ] Remove env-string rewriting except structured adapter-owned setup if strictly needed.
- [ ] Update tests that currently expect `/workspace` → `/vercel/sandbox` rewrite.
- [ ] Add tests for `pwd`, `$PWD`, and normal output not leaking `/vercel/sandbox`.
- [ ] If `/workspace` cannot be made real, stop and redesign rather than silently rewriting shell text.

### Track D — `.boring-agent/` runtime layout

- [ ] Create/use `.boring-agent/bin` for command shims and linked bins.
- [ ] Create/use `.boring-agent/node` for Node CLI package installs.
- [ ] Create/use `.boring-agent/venv` for Python SDK/tool venv.
- [ ] Create/use `.boring-agent/sdk` for copied/local SDK sources.
- [ ] Create/use `.boring-agent/state` for provisioning manifests and ownership markers.
- [ ] Create/use `.boring-agent/cache` for npm/pip/uv caches when practical.
- [ ] Create/use `.boring-agent/tmp` for atomic provisioning staging.
- [ ] Create/use `.boring-agent/logs` for provisioning/runtime doctor logs.
- [ ] Move provisioning marker to `.boring-agent/state/provisioning.json`.
- [ ] Keep backward-compatible read of old `.boring-agent/provisioning.json`.
- [ ] Ignore old top-level `.venv` for agent runtime tools.
- [ ] Remove old top-level `.venv` only when ownership markers prove the agent created it.

### Track E — env and PATH

- [ ] Set `BORING_AGENT_WORKSPACE_ROOT=<runtimeCwd>` for managed commands.
- [ ] Set `VIRTUAL_ENV=<runtimeCwd>/.boring-agent/venv`.
- [ ] Put `<runtimeCwd>/.boring-agent/bin` first on PATH.
- [ ] Put `<runtimeCwd>/.boring-agent/venv/bin` next on PATH.
- [ ] Reject plugin env overrides for `BORING_AGENT_WORKSPACE_ROOT`, `VIRTUAL_ENV`, `HOME`, `PYTHONHOME`.
- [ ] Merge plugin PATH additions after core runtime prefixes.
- [ ] Fix URL env conversion: `file:` → path, `http:`/`https:` → string.

### Track F — Python provisioning

- [ ] Create venv at `.boring-agent/venv`.
- [ ] Prefer `python3 -m venv --copies .boring-agent/venv`.
- [ ] Use `uv pip install --python .boring-agent/venv/bin/python` when available.
- [ ] Run smoke checks in the target runtime.
- [ ] For bwrap, smoke check `/workspace/.boring-agent/venv/bin/python` inside bwrap.
- [ ] For Vercel, run Python provisioning inside the remote sandbox with cwd `/workspace`.
- [ ] Replace broken venvs through `.boring-agent/tmp/venv-*` staging.
- [ ] Do not mark runtime materialized if smoke checks fail.
- [ ] Bump provisioning version.

### Track G — Node CLI provisioning

- [ ] Add `RuntimeNodePackageSpec` / `nodePackages[]` type if missing.
- [ ] Add validation for `nodePackages[]`.
- [ ] Add compose/merge support.
- [ ] Include package specs, lockfiles/tarballs, and bins in fingerprint.
- [ ] Install Node CLI packages into `.boring-agent/node` using npm/pnpm.
- [ ] For `packageRoot`, pack local package and install tarball so remote runtimes work.
- [ ] Link bins into `.boring-agent/bin`.
- [ ] Fail on duplicate bin names unless explicitly aliased.
- [ ] Add default workspace provisioning contribution for `@hachej/boring-ui-cli`.
- [ ] Expose `boring-ui` bin in all plugin-authoring/scaffold-enabled modes.

### Track H — bwrap overlay fix

- [ ] Stop parent `.boring-agent` mount from shadowing child `.boring-agent`.
- [ ] Only mount parent runtime dirs if child lacks its own dir.
- [ ] Add child-vs-parent marker tests.

### Track I — MacroAnalyst cleanup

- [ ] Verify `bm` comes from canonical `python[]` console script path.
- [ ] Verify MacroAnalyst SDK/templates work without app-level shim generation.
- [ ] Remove or retire `src/server/macroSandboxTemplate.ts` if only used for SDK/shim generation.
- [ ] Remove manual SDK copy into `.boring-agent/sdk/boring-macro-sdk` if redundant.
- [ ] Remove hand-written `bm`, `python`, `python3`, `pip`, `pip3` app shims.
- [ ] Keep app-specific skills/docs via `macroProvisioning.templateDirs`.

### Track J — tests and diagnostics

- [ ] Add direct/local/Vercel matrix test fixture.
- [ ] Assert `pwd === runtimeCwd`.
- [ ] Assert `$PWD === runtimeCwd`.
- [ ] Assert model-visible cwd equals file tree root.
- [ ] Assert sandboxed modes do not expose host path.
- [ ] Assert Vercel does not expose `/vercel/sandbox`.
- [ ] Assert `python`, `pip`, Python console script, and `boring-ui` work from PATH.
- [ ] Assert literal command strings are not rewritten.
- [ ] Add runtime doctor output for cwd/env/PATH/provisioning status.
- [ ] Add MacroAnalyst regression for `bm list` and YOY transform.

## Rollout

Suggested implementation split:

1. Runtime context + unified `Workspace` / `Sandbox` cwd contract.
2. Vercel `/workspace` spike and no-rewrite exec change.
3. Env/PATH handling.
4. Runtime-aware Python provisioning.
5. `nodePackages[]` and default `boring-ui` CLI provisioning.
6. Matrix tests for direct, bwrap, Vercel.
7. MacroAnalyst consumes fixed packages.
8. Remove MacroAnalyst-specific duplicate SDK/shim code.
9. Reprovision known-bad workspaces lazily or via explicit force-reprovision tooling.

## Non-goals

- Do not solve MacroAnalyst table-name hallucinations in core.
- Do not force a specific LLM model from app/core code.
- Do not expose host/internal storage paths as normal user-facing API.
- Do not remove direct mode behavior.
- Do not solve full Node/Rust/Go build-cache portability beyond CLI provisioning.
