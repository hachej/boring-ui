# Plan — Lean on pi's tools; plug our backends per-mode via Operations

**Status:** draft v3 — design locked 2026-04-28, not yet started.
**Path:** `boring-ui-v2/packages/agent/`
**Sequencing:** ships first; PLUGIN_MODEL.md (workspace) lands after.

## TL;DR

We currently hand-roll six tool implementations under pi's standard names
(`bash`, `read`, `write`, `edit`, `find_files`, `grep_files`) and shadow pi's
defaults via `customTools`. **Pi was designed to support exactly our use
case** — issue [#564](https://github.com/badlogic/pi-mono/issues/564)
explicitly added the `XxxOperations` seam "for remote delegation" with an
SSH example as its acceptance criteria. We should adopt pi's tools and plug
our backends through Operations, mirroring pi's `examples/extensions/ssh.ts`
canonical pattern.

Two phases:

- **Phase 0 — Clean up the existing tool files.** Pure refactor: extract
  shared primitives, drop dead code, fix inconsistencies. ~150 LOC removed.
  Stands alone even if Phase 1 is deferred.

- **Phase 1 — Per-mode tool wiring against pi's factories.** Each
  `RuntimeModeAdapter` (`direct`/`local`/`vercel-sandbox`) declares its own
  tool list. Most tools are pi defaults verbatim; modes only override
  Operations where the underlying platform actually differs.

After both phases: **~570 LOC of code we own** vs ~1830 today — a **75%
reduction** on this surface. Plus we gain pi's polish for free (process-tree
kill on abort, macOS path-fuzzy-match, auto-fd/rg-download, smarter
truncation, .gitignore-aware globber).

## Design principles (locked)

Three principles govern every decision in this plan. When in doubt, default
to the lower-numbered principle:

### Principle 1 — Leverage pi's model-facing surface verbatim

Tool **names**, **schemas**, **prompt snippets**, and **guideline phrasing**
all come from pi unchanged. The model sees a stock pi agent. This means:

- Use pi's tool names (`find`, `grep`, `read`, `write`, `edit`, `bash`,
  `ls`) — never our own variants.
- Use pi's TypeBox schemas as authored — never re-declare them in our
  code.
- Use pi's `promptSnippet` wording — never wrap it with our own bullets
  or guideline bullets.
- Future pi tool releases (e.g. a hypothetical `tree`) flow into our
  catalog with zero shape work on our side.

The motivation: **cross-agent conventions**. Models trained on
pi/Claude Code/Cursor naming and schemas perform better with consistent
surface area across agents. Diverging is a tax we pay every turn.

### Principle 2 — Replace internal behavior via Operations / spawnHooks

When we need different *behavior* (sandboxed exec, remote VM, audit
logging), we plug it in through pi's `XxxOperations` seam — never by
shadowing pi's tool with our own definition. This is the entire point of
pi-mono#564 and the canonical SSH/sandbox extension patterns.

Consequence: every line of code we own is in **`Operations` adapters,
`spawnHook`s, or shared resource bundles** — not in tool definitions
themselves. Adding a new sandbox provider (Modal, Docker, Apple
container) is "implement six Operations interfaces" — not "rewrite six
tools."

### Principle 3 — Add custom AgentTools only when pi cannot be made to work

Custom AgentTools (registered via `customTools` through
`tool-adapter.ts`) exist for **two cases only**:

1. **Pi has no equivalent.** Example: `executeIsolatedCodeTool` — pi
   doesn't ship per-call ephemeral sandboxes.
2. **Pi's tool architecture cannot accommodate our backend.** Example:
   `vercelGrepTool` — pi's `GrepOperations` cannot redirect the
   ripgrep spawn (only `isDirectory` + `readFile` for context lines),
   so in vercel-sandbox mode we *must* roll our own that runs `rg`
   inside the VM via `sandbox.exec`. **Even then we mirror pi's grep
   schema 1:1** so the model's grep behavior is identical across modes
   — Principle 1 still applies to the schema.

Any new addition to `customTools` must justify itself against these two
cases in its PR description. If neither applies, it's an Operations
adapter waiting to happen.

### Anti-patterns these principles forbid

- Shadowing pi's tool names with re-implementations under the same name.
- Re-declaring pi's schemas (even "for clarity"). The schema lives in pi.
- Adding per-tool guideline bullets (`Prefer the X tool when...`) — pi's
  catalog is sufficient signal; one line per tool is too many.
- Wrapping a pi tool's `promptSnippet` with our own prefix. Pi's wording
  IS the wording.
- Adding a custom tool because "we have a slightly different parameter
  shape we want." Reshape via Operations input/output translation
  instead, or just adopt pi's shape (it's almost always richer).

## Why

### Original spec rationale was thin

`agent-package-spec.md` decision #4 says: "we pass our own `tools: [...]` to
skip pi's defaults." No further justification. Decision #6 budgeted ~200 LOC
for tool factories and explicitly said **"Grep/find/ls done via bash;
dedicated tools deferred."** We've drifted: 1100+ LOC across 6 tools, 5×
budget, with `find_files`/`grep_files` shipped off-spec.

### Pi has the Operations seam expressly for this

Issue [#564 (closed)](https://github.com/badlogic/pi-mono/issues/564) — the
RFC that introduced `XxxOperations` interfaces — opens with: *"Make built-in
tool core operations pluggable so extensions can delegate to remote systems
(e.g., SSH)."* Acceptance criteria included shipping an SSH example. That
example (`examples/extensions/ssh.ts`) is the canonical reference for our
vercel-sandbox mode.

### Pi's defaults are strictly better than ours where they apply

| Capability | Pi default | Ours |
|---|---|---|
| Process-tree kill on bash abort | ✅ via `killProcessTree(pid)` | ❌ child only |
| Auto-download `fd` / `rg` if missing | ✅ via `ensureTool()` | ❌ |
| macOS path NFD / curly-quote / AM-PM normalization on read | ✅ via `resolveReadPath` | ❌ |
| Smart output truncation (head/tail with first-line guard) | ✅ via `truncateHead` | ⚠️ basic |
| `.gitignore`-aware find with `--no-require-git` | ✅ via fd | ✅ via FileSearch |

### Two pi extensions are de-facto reference templates

- `examples/extensions/ssh.ts` — remote backend per-tool override. Lift this
  pattern verbatim for vercel-sandbox.
- `examples/extensions/sandbox/index.ts` — OS-level sandboxing via
  `SandboxManager.wrapWithSandbox(command)` from
  `@anthropic-ai/sandbox-runtime`. Lift the `spawnHook`/wrapped-bash pattern
  for bwrap mode.

### Community signals from pi-mono issues

- **#3782** — *"Default to using custom `grep` tool to prevent context
  pollution and token waste"*: pi made grep a default tool because bare
  `bash grep` over `node_modules` burned ~98k tokens in real sessions.
  Implication: **don't drop dedicated grep — preserve smart-grep behavior
  even in vercel-sandbox**.
- **#3500** — *"Discover skills on remote machine when routing tools through
  SSH"*: SSH extension authors are actively extending the pattern. Pi is
  iterating to make the remote story stronger.
- **#3320 / #2965** — remote context-file (AGENTS.md/CLAUDE.md) loading via
  SSH extension. Pi is solving the full agent-runs-against-remote-system
  case, not just bash forwarding.
- **No open issues** on ssh/remote → the pattern is mature; we're catching
  up to where pi's community already is.

## Phase 0 — Clean up the existing tool files (precursor)

Pure refactor. No behavior change. Independent of Phase 1 — even if Phase 1
were deferred indefinitely, this step stands alone.

### Audit findings (cross-file duplication, inconsistencies, dead code)

#### Cross-file duplication

1. `makeError(message)` declared identically in all 6 files.
2. `FileChangeMetadata` declared 3 times with one divergent field.
3. `bytesWritten()` identical in `editTool.ts:68-70` and `writeTool.ts:81-83`.
4. `nowIso()` identical in `editTool.ts:72-74` and `writeTool.ts:85-87`.
5. `normalizeLimit()` identical in `findFilesTool.ts:22-36` and
   `grepFilesTool.ts:32-46`.
6. Two separate `TextDecoder('utf-8', { fatal: false })` instances.
7. `DEFAULT_LIMIT = 200`, `MAX_LIMIT = 5_000`, `MAX_*_LENGTH = 256`
   repeated.

#### Inconsistencies

8. `bashTool.ts:209-214` inlines its error object instead of using
   `makeError`.
9. `bashTool.ts` is the only file that doesn't check
   `ctx.abortSignal.aborted` at the start.
10. `additionalProperties: false` on the JSON schema only on
    `findFilesTool` and `grepFilesTool`.
11. Param descriptions only on `grepFilesTool`.
12. `grepFilesTool.ts:64` uses `parseInt(..., 10)`; rest use
    `Number.isInteger`.
13. Param-typing approach varies (raw `params`, `XxxParams` interface,
    `as Record<string, unknown>`).
14. Error phrasing varies (`"X aborted"` vs `"X failed: msg"` vs
    `"unknown X failure"`).

#### Dead / questionable code

15. `readTool.ts:97` — stale TODO referencing a long-shipped milestone.
16. `bashTool.ts:9-11` — single-use `decode()` helper.
17. `editTool.ts:46-66` — two near-identical replace functions; can be one.
18. `writeTool.ts:75-79` — `makeTmpPath` sanitizes `toolCallId` even
    though pi guarantees UUIDs. Either real defense-in-depth (document) or
    dead.
19. `findFilesTool.ts:54` — description mentions `vercel-sandbox mode`
    even though the tool has no sandbox knowledge.
20. `bashTool.ts:23-194` — 170 lines of shell-parsing for
    `inferBashFileChanges`. Wrong file. **Defer to a separate PR** —
    independent of this plan.
21. `bashTool.ts:234-244` — emits the same fields twice (text + details);
    document why.

### What `_shared.ts` exports

```ts
// src/server/catalog/tools/_shared.ts
export function makeError(message: string): ToolResult
export function bytesWritten(content: string): number
export function nowIso(): string
export function normalizeLimit(
  raw: unknown,
  opts: { default: number; max: number },
): { limit: number; error?: string }

export const decoder: TextDecoder
export function decode(bytes: Uint8Array): string

export type FileChangeOp = 'write' | 'edit' | 'unlink' | 'rename' | 'mkdir'
export interface FileChangeMetadata {
  op: FileChangeOp
  path: string
  oldPath?: string
  timestamp: string
  size?: number
  /** Distinguishes file:created from file:changed. Universal field
   *  (set even by edit ops, where it's always true). */
  existsBefore?: boolean
}

export const DEFAULT_TOOL_LIMIT = 200
export const MAX_TOOL_LIMIT = 5_000
export const MAX_PATTERN_LENGTH = 256
```

### Phase 0 standardization decisions

1. **`existsBefore` on `FileChangeMetadata` becomes universal.** `editTool`
   starts emitting `existsBefore: true` so the workspace bridge sees a
   consistent shape.
2. **`additionalProperties: false` everywhere.** Tightens the model-facing
   tool contract.
3. **`toolCallId` sanitization in `writeTool`** stays as defense-in-depth
   with a one-line comment.

### Phase 0 verification

- `pnpm exec tsc --noEmit` clean.
- All 6 tool tests + new `_shared.test.ts` green.
- `bash scripts/check-invariants.sh packages/agent` passes.
- No tool file imports `makeError`/`bytesWritten`/`nowIso`/`normalizeLimit`
  from anywhere except `_shared.ts`.

### Phase 0 estimated scope

- New: `_shared.ts` (~80 LOC) + `_shared.test.ts` (~50 LOC).
- Touched: all 6 tool files (~30-40% smaller each).
- Net: ~ **-20 LOC** (mostly redistribution).
- Risk: very low.

## Phase 1 — Per-mode tool wiring against pi's factories

The cleanest design is **bundle factories that produce mode-appropriate
tools**, called from both the standalone agent path (`createAgentApp`) and
the workspace plugin path (`filesystemPlugin`). Each bundle factory takes a
`RuntimeBundle` and returns `AgentTool[]` constructed via pi's factories
with mode-specific Operations injected.

`RuntimeModeAdapter` does NOT carry a `tools` field. Modes own *resources*
(workspace, sandbox, fileSearch); they don't own tool registration. Tool
registration is split across two bundles, both per-mode-aware:

- `buildHarnessAgentTools(bundle)` — produces `[bash,
  executeIsolatedCode]`. Always registered by `createAgentApp` directly
  (per PLUGIN_MODEL.md line 122: bash + isolated-code stay harness-level).
- `buildFilesystemAgentTools(bundle)` — produces `[read, write, edit,
  find, grep, ls]`. Registered by `createAgentApp` by default with
  `disableDefaultFileTools` opt-out, AND by the workspace's
  `filesystemPlugin` via `agentTools: buildFilesystemAgentTools(bundle)`.

This preserves PLUGIN_MODEL.md's plugin contract (`Plugin.agentTools:
AgentTool[]`) — the dynamism is hidden in the factory call at plugin
instantiation. From the plugin pipeline's perspective the array is data;
late-wins-on-id and `excludeDefaults` work unchanged.

### Alignment with PLUGIN_MODEL.md

PLUGIN_MODEL.md (workspace) defines the plugin pipeline that consumes our
file-ops tools. Without any change to its contract, this plan slots in
cleanly via two adjustments:

1. **`filesystemPlugin` becomes a factory.** Currently described in
   PLUGIN_MODEL.md (lines 558-575) as importing a static
   `filesystemAgentTools` bundle. After this plan ships:
   ```ts
   export function filesystemPlugin(bundle: RuntimeBundle): Plugin {
     return {
       id: 'filesystem',
       label: 'Filesystem',
       agentTools: buildFilesystemAgentTools(bundle),
       panels: [...],
       catalogs: [...],
     }
   }
   ```
   The host calls `filesystemPlugin(bundle)` at app boot with the resolved
   `RuntimeBundle`. PLUGIN_MODEL.md needs a small note documenting that
   default plugins can be factories (not just static module exports). The
   `Plugin` interface itself is unchanged — `agentTools: AgentTool[]` stays
   a plain array.
2. **Tool name update.** `find_files`/`grep_files` references in
   PLUGIN_MODEL.md (lines 1145, 1550-1554) become `find`/`grep`. Doc-only
   change; can co-land or follow up.

### Five PLUGIN_MODEL guarantees we preserve

1. Plugin contract `Plugin.agentTools: AgentTool[]` unchanged — array is
   constructed at plugin instantiation.
2. Late-wins-on-id works — operates on the array; doesn't care how
   entries were constructed.
3. `excludeDefaults: ['filesystem']` truly removes file tools — host
   doesn't construct the plugin in the first place.
4. Standalone path stays default-on with `disableDefaultFileTools` opt-out
   — `createAgentApp` calls `buildFilesystemAgentTools` directly,
   bypassing the plugin pipeline.
5. Bash + isolated-code stay harness-level — they flow through
   `buildHarnessAgentTools` which `createAgentApp` always registers
   directly, never via plugin.

### How pi resolves paths (architectural prerequisite)

Pi expects model-supplied paths and resolves them against `cwd` via
`resolveToCwd(filePath, cwd)` in `dist/core/tools/path-utils.js`. **Pi does
no bounding** — `../../../etc/passwd` resolves cleanly to its absolute path
and is passed to `Operations.readFile(absPath)`. Path-bounding is 100% the
Operations adapter's responsibility.

This matches `agent-package-spec.md` decision #7a (Workspace enforces
path-bounding via `validatePath` / `assertRealPathWithinWorkspace`). We move
the bounding from inside our hand-rolled tool to inside the Operations
adapter — same security posture, different layer.

### `RuntimeModeAdapter` after this plan

Modes own only resources, not tools:

```ts
// src/server/runtime/mode.ts (sketch)
export interface RuntimeBundle {
  mode: 'direct' | 'local' | 'vercel-sandbox'
  workspace: Workspace
  sandbox: Sandbox
  fileSearch: FileSearch
  // No `tools` field — bundles produce tools, not modes.
}
```

### `buildHarnessAgentTools(bundle)` — bash + isolated-code

Always registered by `createAgentApp` directly. Never goes through the
plugin pipeline (per PLUGIN_MODEL.md non-goal line 122).

```ts
// src/server/tools/harness/index.ts (sketch)
import { createBashTool, createLocalBashOperations } from '@mariozechner/pi-coding-agent'
import { executeIsolatedCodeTool } from '../executeIsolatedCodeTool'

export function buildHarnessAgentTools(bundle: RuntimeBundle): AgentTool[] {
  const tools: AgentTool[] = []
  tools.push(createBashTool(bundleCwd(bundle), bashOptionsForMode(bundle)))
  if (bundle.sandbox.capabilities.includes('isolated-code')) {
    tools.push(executeIsolatedCodeTool(bundle.sandbox))
  }
  return tools
}

function bashOptionsForMode(bundle: RuntimeBundle): BashToolOptions {
  switch (bundle.mode) {
    case 'direct':
      return { operations: createLocalBashOperations() }   // pi default verbatim
    case 'local':
      return {
        operations: createLocalBashOperations(),
        spawnHook: bwrapSpawnHook(bundle.workspace.root),  // bwrap wrap
      }
    case 'vercel-sandbox':
      return { operations: vercelBashOps(bundle.sandbox) }
  }
}
```

### `buildFilesystemAgentTools(bundle)` — read/write/edit/find/grep/ls

Registered by `createAgentApp` by default (opt-out via
`disableDefaultFileTools`) AND by `filesystemPlugin` (workspace path).

```ts
// src/server/tools/filesystem/index.ts (sketch)
import {
  createReadTool, createWriteTool, createEditTool,
  createFindTool, createGrepTool, createLsTool,
} from '@mariozechner/pi-coding-agent'
import { boundFs } from '../operations/bound'
import { vercelReadOps, vercelWriteOps, /* … */ } from '../operations/vercel'
import { vercelGrepTool } from '../vercelGrepTool'

export function buildFilesystemAgentTools(bundle: RuntimeBundle): AgentTool[] {
  const cwd = bundleCwd(bundle)
  switch (bundle.mode) {
    case 'direct':
    case 'local':
      // Workspace IS the host fs; pi's defaults are correct. Path-bound
      // read/write/edit/ls; pi's fd/rg are .gitignore-aware on host fs.
      return [
        createReadTool(cwd, { operations: boundFs(cwd).read }),
        createWriteTool(cwd, { operations: boundFs(cwd).write }),
        createEditTool(cwd, { operations: boundFs(cwd).edit }),
        createFindTool(cwd),
        createGrepTool(cwd),
        createLsTool(cwd, { operations: boundFs(cwd).ls }),
      ]
    case 'vercel-sandbox':
      // Workspace is in the VM; route Operations to sandbox.*. Grep is a
      // custom AgentTool because pi's GrepOperations can't redirect the
      // actual rg spawn (see "Why grep is a custom AgentTool" below).
      return [
        createReadTool(cwd, { operations: vercelReadOps(bundle.sandbox) }),
        createWriteTool(cwd, { operations: vercelWriteOps(bundle.sandbox) }),
        createEditTool(cwd, { operations: vercelEditOps(bundle.sandbox) }),
        createFindTool(cwd, { operations: vercelFindOps(bundle.sandbox) }),
        vercelGrepTool(bundle.sandbox),  // custom AgentTool, see below
        createLsTool(cwd, { operations: vercelLsOps(bundle.sandbox) }),
      ]
  }
}
```

### Mode-by-mode summary of what's overridden

| Tool | direct | local (bwrap) | vercel-sandbox |
|---|---|---|---|
| `bash` | pi default | pi default + `spawnHook` (bwrap wrap) | custom Operations → `sandbox.exec` |
| `read` | pi default + path-bounding wrapper | same as direct | custom Operations → `sandbox.fs.read` |
| `write` | pi default + path-bounding wrapper | same as direct | custom Operations → `sandbox.writeFiles` |
| `edit` | pi default + path-bounding wrapper | same as direct | custom Operations → `sandbox.fs.read+write` |
| `find` | pi default (auto-downloads `fd`) | same as direct | custom Operations runs `fd` in VM via `sandbox.exec` |
| `grep` | pi default (auto-downloads `rg`) | same as direct | **custom AgentTool** (pi's GrepOperations can't redirect search) |
| `ls` | pi default + path-bounding wrapper | same as direct | custom Operations → `sandbox.fs.readdir` |

`bwrapSpawnHook(root)` and `boundFs(root)` (with `.read`/`.write`/`.edit`/`.ls`
sub-objects) are tiny helpers in `src/server/tools/operations/bound.ts`
(~30 LOC). Vercel Operations adapters live in
`src/server/tools/operations/vercel.ts` (~150 LOC).

### `vercelGrepTool` design

Mirrors pi's grep schema 1:1 so the model's grep behavior is identical
across modes. Spawns `rg` inside the VM via `sandbox.exec` and parses
ripgrep's output the same way pi does.

```ts
// src/server/tools/vercelGrepTool.ts (sketch)
import type { AgentTool } from '../../shared/tool'
import type { Sandbox } from '../../shared/sandbox'
import { decode, makeError, normalizeLimit, MAX_PATTERN_LENGTH } from './_shared'

const DEFAULT_LIMIT = 200

export function vercelGrepTool(sandbox: Sandbox): AgentTool {
  return {
    name: 'grep',                                          // ← match pi's name, NOT 'grep_files'
    description:
      'Search file contents by pattern across the workspace. Returns ' +
      'file paths, line numbers, and matching text. Prefer this over ' +
      'shell grep loops to keep results bounded and .gitignore-respecting.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern (or literal if literal=true).' },
        path: { type: 'string', description: 'Sub-tree to search (default: workspace root).' },
        glob: { type: 'string', description: 'File glob filter (e.g. "*.ts").' },
        ignoreCase: { type: 'boolean' },
        literal: { type: 'boolean', description: 'Treat pattern as literal string, not regex.' },
        context: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 5000 },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      // Validate + build rg args mirroring pi's `dist/core/tools/grep.js:130-180`
      // (smart-case, --no-heading, -m limit, -g glob, -C context, --fixed-strings if literal).
      // Run inside the VM:
      //   sandbox.exec(`rg ${args.join(' ')}`, { signal, timeoutMs })
      // Parse stdout the same way pi does (file:line:text).
      // Return matches via the same `details: { matches, truncated, ... }` shape
      // pi's createGrepTool does so the renderer match its UI affordance.
      ...
    },
  }
}
```

Why a custom AgentTool, not a pi factory:

Pi's `GrepOperations` interface (`dist/core/tools/grep.d.ts:21-29`) only
exposes:

```ts
interface GrepOperations {
  isDirectory: (absolutePath: string) => Promise<boolean> | boolean
  readFile: (absolutePath: string) => Promise<string> | string
}
```

The actual ripgrep spawn is hardcoded local
(`grep.js:144: spawn(rgPath, args, { stdio: ... })`) — the Operations only
plug in the directory-existence check and the readFile-for-context-lines.
**There's no seam to redirect the search itself to a remote backend.**

Notably, pi's own `examples/extensions/ssh.ts` does **not** override
`grep` — which means in SSH mode that example produces wrong results
(searches the agent host, not the remote). The example is incomplete on
this point. Issue [#3782 (closed)](https://github.com/badlogic/pi-mono/issues/3782)
made dedicated `grep` a default because bare `bash grep` over `node_modules`
burned ~98k tokens per session. **We can't drop grep**.

So in vercel-sandbox we register our own `grep` AgentTool via `customTools`
that spawns `rg` inside the VM via `sandbox.exec` and parses output.
~80 LOC. Pi's `customTools` adapter handles the prompt-snippet and
schema; the tool's `execute` does the work. **One custom tool**, not six.

#### What `vercelXxxOps` looks like

Mirrors `examples/extensions/ssh.ts:81-112`. For bash:

```ts
// src/server/catalog/tools/operations/vercel.ts
export function vercelBashOps(sandbox: Sandbox): BashOperations {
  return {
    exec(command, cwd, { onData, signal, timeout }) {
      return new Promise((resolve, reject) => {
        const child = sandbox.spawn(['bash', '-c', command], { cwd, env: ... })
        child.stdout.on('data', onData)
        child.stderr.on('data', onData)
        signal?.addEventListener('abort', () => child.kill(), { once: true })
        const timer = timeout
          ? setTimeout(() => child.kill(), timeout * 1000)
          : undefined
        child.on('exit', (code) => {
          if (timer) clearTimeout(timer)
          if (signal?.aborted) reject(new Error('aborted'))
          else resolve({ exitCode: code })
        })
      })
    },
  }
}
```

Read/write/edit/ls are similar: forward `(absPath, ...)` to
`sandbox.fs.read` / `sandbox.writeFiles` / etc. Find's `glob` Operations
runs `fd` inside the VM via `sandbox.exec` and parses stdout.

### What we delete

- `src/server/catalog/tools/bashTool.ts`
- `src/server/catalog/tools/readTool.ts`
- `src/server/catalog/tools/writeTool.ts`
- `src/server/catalog/tools/editTool.ts`
- `src/server/catalog/tools/findFilesTool.ts`
- `src/server/catalog/tools/grepFilesTool.ts`
- All co-located test files for the above.
- Per-tool `promptGuidelines` and the double-dash `promptSnippet` in
  `tool-adapter.ts` (no longer needed for standard tools — pi's factories
  carry their own snippets).

`tool-adapter.ts` stays for genuinely-custom tools: `vercelGrepTool`,
`executeIsolatedCodeTool`, plugin tools, host-supplied `extraTools`.

### Tool name change: `find_files`/`grep_files` → `find`/`grep`

Pi's tool names are `find` and `grep`. Drop the `_files` suffix to align.
Callsites to update:

- `packages/agent/src/ui-shadcn/workspaceToolRenderers.tsx:30` (renderer
  map keyed by name).
- `packages/workspace/src/components/chat/workspaceToolRenderers.tsx` if
  distinct.
- Any test mocks asserting the old names.
- PLUGIN_MODEL.md (lines 1145, 1550-1554) — doc-only update; can be
  co-landed or follow-up.
- README / AGENTS.md if mentioned.

The model is unaffected — pi's name shows up in the tool catalog each turn;
no persisted state references the old names.

### Migration plan (incremental, mode-by-mode reversible)

Sequencing: build the seam first (step 1), then flip one mode at a time
(steps 2-4) so each mode can be reverted independently if it regresses.
Hand-rolled tools survive until step 5; they're the rollback target if
any single mode flip fails.

Each step is a single PR-sized chunk. After every step: `tsc --noEmit`
clean, test suite green, manual smoke against the playground in the
affected mode(s).

#### Step 1.0 — Add streaming callbacks to `Sandbox.exec` (precursor)

**New precursor.** Today `ExecOptions` has no `onStdout`/`onStderr`
callbacks; `Sandbox.exec` returns full output at end. Pi's
`BashOperations.exec` requires incremental `onData(buf)` calls. This step
extends our shared interface and all three adapters before any tool
migration begins.

- Extend `ExecOptions` in `packages/agent/src/shared/sandbox.ts` with
  `onStdout?: (chunk: Uint8Array) => void` and
  `onStderr?: (chunk: Uint8Array) => void`. Keep buffered `stdout`/`stderr`
  in `ExecResult` for backward compat — adapter logic both streams AND
  collects (the buffered fields stay populated for non-pi consumers).
- `DirectSandbox`: switch from `child_process.exec` (buffered) to
  `spawn`; wire `child.stdout.on('data', ...)` to invoke `onStdout` and
  also accumulate into the result buffer.
- `BwrapSandbox`: same pattern, wrap the bwrap-spawn child.
- `VercelSandboxExec`: replace `command.stdout() + command.stderr()` with
  either `Command.logs()` async-generator or `runCommand({ stdout:
  writable, stderr: writable })` pipe-to-Writable (SDK supports both;
  `Writable` is simpler). Apply the existing `maxOutputBytes` cap as
  bytes arrive; the buffer never holds more than the cap.
- Tests: each adapter receives ≥ 2 `onStdout` calls for `seq 1 100`,
  AND the final `ExecResult.stdout` is the full collected output, AND
  `maxOutputBytes` truncation fires correctly under streaming.

**Acceptance:** typecheck clean, all sandbox adapter tests green, no
behavior change for callers that don't pass `onStdout`/`onStderr`.

#### Step 1 — Build Operations adapters + bundle factories (pure additive)

- New file `src/server/tools/operations/bound.ts` exporting
  `boundFs(root)` returning `{ read, write, edit, ls }` Operations
  sub-objects. Each does abs-path-bounding via
  `assertRealPathWithinWorkspace` (port the helper from
  `packages/agent/src/server/workspace/paths.ts`) before delegating to
  pi's default backend. Symlink resolution included — see R8.
- New file `src/server/tools/operations/vercel.ts` exporting
  `vercelBashOps`, `vercelReadOps`, `vercelWriteOps`, `vercelEditOps`,
  `vercelFindOps`, `vercelLsOps` — each routes to `sandbox.*` methods.
- New files `src/server/tools/harness/index.ts` and
  `src/server/tools/filesystem/index.ts` exporting
  `buildHarnessAgentTools(bundle)` and `buildFilesystemAgentTools(bundle)`.
- New file `src/server/tools/vercelGrepTool.ts` (matches pi's grep
  schema 1:1; see "vercelGrepTool design" above).
- Tests in `__tests__/`:
  - `boundFs` rejects paths outside workspace, including via symlink.
  - Each `vercel*Ops` adapter mocks `sandbox` and asserts correct
    forwarding.
  - `buildHarnessAgentTools(bundle)` returns the right tools per mode.
  - `buildFilesystemAgentTools(bundle)` returns the right tools per mode
    (incl. `vercelGrepTool` instead of `createGrepTool` for vercel-sandbox).
  - `vercelGrepTool` parses ripgrep output correctly against a fake
    `sandbox.exec`.
- Nothing else changes. `standardCatalog.ts` still produces the hand-rolled
  tools that the harness uses.

#### Step 2 — Flip `direct` mode

- In `createAgentApp.ts`, when `mode === 'direct'`, swap from
  `standardCatalog(...)` to `[...buildHarnessAgentTools(bundle),
  ...(disableDefaultFileTools ? [] : buildFilesystemAgentTools(bundle))]`.
- Other modes still use `standardCatalog` — they're unaffected.
- Smoke: playground (which auto-detects direct mode by default) — bash,
  read, write, edit, find, grep all work; system prompt loses ~700 chars
  of double-dash + per-tool-guideline noise.
- **Rollback:** revert this PR; hand-rolled tools come back into use for
  direct mode.

#### Step 3 — Flip `local` mode (bwrap)

- Same swap as step 2 but for `mode === 'local'`. Adds the `bwrapSpawnHook`
  to `bashOptionsForMode` for local.
- Smoke: spin up local mode (bwrap installed); verify bwrap appears in the
  process tree during a `bash` turn; verify file ops are still
  workspace-bounded.
- **Rollback:** independent revert.

#### Step 4 — Flip `vercel-sandbox` mode

- Same swap for `mode === 'vercel-sandbox'`. Adds vercel Operations to
  `bashOptionsForMode` and `buildFilesystemAgentTools`'s vercel branch.
- Smoke: deploy a vercel-sandbox playground; send a turn that exercises
  bash, read, write, edit, find, grep — all should hit `sandbox.*` (verify
  via sandbox-side log).
- Update `packages/agent/src/ui-shadcn/workspaceToolRenderers.tsx:30` to
  add a renderer for the (custom) `grep` tool keyed by name. Pi's
  schema-driven render works for the other tools as-is.
- **Rollback:** independent revert.

#### Step 5 — Delete hand-rolled tools + standardCatalog

After all three modes have been flipped and burned in for a few days:

- Delete `src/server/catalog/tools/{bashTool,readTool,writeTool,editTool,findFilesTool,grepFilesTool}.ts`
  and their co-located tests.
- Delete `src/server/catalog/standardCatalog.ts`.
- `tool-adapter.ts` no longer needs the double-dash `promptSnippet` or
  per-tool `promptGuidelines` workarounds; final shape is ~30 LOC mapping
  our `AgentTool` to pi's `ToolDefinition` for genuinely-custom tools
  only (`vercelGrepTool`, `executeIsolatedCodeTool`, plugin tools,
  host-supplied `extraTools`).

#### Step 6 — Tool-name renames downstream

- Rename `find_files`→`find` and `grep_files`→`grep` in:
  - `packages/agent/src/ui-shadcn/workspaceToolRenderers.tsx:30` (renderer
    map keyed by name).
  - `packages/workspace/src/components/chat/workspaceToolRenderers.tsx`
    if distinct.
  - Any test mocks asserting old names.
  - PLUGIN_MODEL.md (lines 1145, 1550-1554) — doc-only update.
  - boring-macro-v2 if it asserts tool names anywhere.
  - README / AGENTS.md if tool names mentioned.

Could fold into step 4 if testing burden allows; separate PR if the rename
turns out to touch many files.

#### Step 7 — Optional: `ls` + final cleanup

- Spec deferred ls; pi's `createLsTool` is a 5-LOC add per mode in
  `buildFilesystemAgentTools`. Adds an explicit "list directory" affordance
  and reduces `bash ls` usage. Independent decision.
- Update `agent-package-spec.md` decisions #4 and #6 with post-migration
  reality (or mark superseded by this plan).

## Risks and open questions

### R1 — Pi schema drift from ours (concrete audit)

| Tool | Ours (today) | Pi | Compatibility |
|---|---|---|---|
| `read` | `{ path, lineOffset?, lineCount? }` | `{ path, offset?, limit? }` | **Breaking rename.** Field semantics identical (1-indexed line slice). Document in PR. |
| `write` | `{ path, content, createDirs? }` | `{ path, content }` (mkdir-recursive always) | **Breaking simplification.** Pi always creates parent dirs; we have a flag. Drop the flag in favor of pi's behavior — matches user expectation. |
| `edit` | `{ path, oldString, newString, replaceAll? }` | `{ path, edits: [{ oldText, newText }] }` | **Breaking restructure.** Pi's shape is strictly more powerful (multi-edit per call, atomic). Drop ours, gain batch-edit for free. Update tool renderers for the new render shape. |
| `bash` | `{ command }` | `{ command, timeout? }` | **Pure superset.** Add timeout support. |
| `find`/`find_files` | `{ glob, limit? }` | `{ pattern, path?, limit? }` | **Breaking field rename + new field.** `glob → pattern`, plus optional `path` arg for sub-tree search. Better. |
| `grep`/`grep_files` | `{ pattern, glob?, limit? }` | `{ pattern, path?, glob?, ignoreCase?, literal?, context?, limit? }` | **Pure superset.** Pi gains literal/case/context flags. **`vercelGrepTool` MUST mirror pi's full schema** so model behavior is consistent across modes. |
| `ls` (new) | (none) | `{ path?, limit? }` | New affordance, no migration. |

All schema breaks are model-facing — the AI SDK sends whatever JSON the
model emits; pi validates against its TypeBox schema and rejects malformed
calls. Models trained on pi's schemas (which is most of them — pi's names
are the cross-agent default) will do BETTER, not worse, after the swap.

**Mitigation:** capture the full schema diff per tool in the corresponding
step's PR description; tool renderers update co-landed (they're keyed by
tool name + render the input schema). One round of e2e tests per mode
confirms the model emits correct shapes against the new schemas.

### R2 — Pi's tool names are `find`/`grep`, not `find_files`/`grep_files`

Already addressed above. Smoothest place to do the rename is Step 4 (the
delete-hand-rolled-files step) where every other tool-name reference is
already being touched.

### R3 — `vercelGrepTool` doesn't share pi's grep render

Pi's `createGrepTool` ships a render component (`grep.d.ts:42` —
`ToolDefinition<...>` includes render). Our custom AgentTool gets the
generic fallback renderer. We can either:

- Accept the visual asymmetry between modes (vercel-sandbox grep looks
  different from direct/local).
- File a feature request (`#3782`-style) to add a `search()` method to
  `GrepOperations` so we could use pi's grep tool with a remote backend.

**Mitigation:** ship as-is, file the upstream FR; revisit if the asymmetry
proves annoying. A custom tool renderer in
`workspaceToolRenderers.tsx` keyed on `grep` could close the gap.

### R4 — `tools: []` was load-bearing

Today's `tools: []` deliberately disables pi's `codingTools` to avoid name
collision with our `customTools`. After migration, we want
`tools: runtimeBundle.tools` (a list of pi-built factories). The empty-array
trick must be removed or we'll register zero tools.

**Mitigation:** mechanical change in `createHarness.ts`; PR review confirms
`tools` is not the empty array on completion.

### R5 — Output truncation regressions + bash streaming

Pi's `BashOperations.exec` requires an `onData(buf)` callback that is
called incrementally as bytes arrive. Our current `Sandbox.exec` is
buffered — it returns `Promise<ExecResult>` with full `stdout`/`stderr`
collected at the end (`packages/agent/src/shared/sandbox.ts:5-36`).
Calling `onData(allBytes)` once at end works for correctness but blocks
pi's mid-command truncation logic, risking memory blowup on
unbounded-output commands (`find / -type f` style) — especially in
`vercel-sandbox` mode where the buffer accumulates in the VM.

**Verified resolution (smoke-tested 2026-04-28):** the `@vercel/sandbox`
SDK supports streaming via two APIs (`Command.logs()` async-generator
and `runCommand({ stdout, stderr: Writable })` pipe-to-stream). Smoke
script at `packages/agent/scripts/smoke-vercel-sandbox.mts` ran a
100-line command and observed **80 incremental `Writable.write()`
calls** spread across the 1.3-second run — first chunk at +421ms, not
buffered-and-dumped. Abort latency ~12ms. The streaming question is
empirically resolved.

Our current `createVercelSandboxExec.ts:91-97` uses the buffered
convenience accessors `command.stdout()` + `command.stderr()` by choice,
not necessity. `DirectSandbox` and `BwrapSandbox` use `child_process`
which has streamed via `child.stdout.on('data', ...)` since forever.

**Mitigation: bead `uhwx.5b` (a new precursor)** extends `ExecOptions`
with optional `onStdout`/`onStderr` callbacks and updates all three
sandbox adapters to invoke them as bytes arrive. ~4-6 hours total. Gates
`uhwx.6` (vercel*Ops) and `uhwx.7` (buildHarnessAgentTools) since both
need streaming bash.

After `uhwx.5b`, pi's bash tool plugs in cleanly:

```ts
return {
  exec(command, cwd, { onData, signal, timeout, env }) {
    return bundle.sandbox.exec(command, {
      cwd, env, signal, timeoutMs: timeout && timeout * 1000,
      onStdout: (buf) => onData(Buffer.from(buf)),
      onStderr: (buf) => onData(Buffer.from(buf)),
    }).then(result => ({ exitCode: result.exitCode }))
  }
}
```

### R6 — Pi version pin

Operations API exists in `pi-coding-agent@0.67.68` (current pin). Locked
floor.

**Mitigation:** none needed — we already exact-pin pi.

### R7 — Path-bounding error message must reach the model usefully

Today, our hand-rolled tools return `{ isError: true, content: [{ type:
'text', text: 'path is outside workspace' }] }` — the model sees a clear
text error. After migration, an Operations adapter that throws gets
formatted by pi's error path. We need to verify the model sees a
meaningful message (not "Error: ENOENT" or stack-trace noise).

**Mitigation:** in `boundFs`, throw with a specific message:
```ts
throw new Error(`path "${rel}" is outside workspace`)
```
Add a test that exercises this path through a full pi tool call and
asserts the resulting `text-delta` chunks contain a useful message.

### R8 — Symlink escapes via `boundFs`

`assertRealPathWithinWorkspace` (per spec line 390) resolves symlinks
*before* bounding so a symlink inside the workspace pointing to
`/etc/passwd` is rejected. Pi's `resolveToCwd` does NOT do this — it just
joins paths. **`boundFs` must call `fs.realpath` (or equivalent)** before
the `isUnder` check.

**Mitigation:** port `assertRealPathWithinWorkspace` from
`packages/agent/src/server/workspace/paths.ts` into the `boundFs`
implementation (or call it directly). Add a test creating a symlink in
the workspace pointing outside it and asserting the read is rejected.

### R9 — Streaming compatibility with our `useChat` UI

Pi's tool factories emit specific `tool_execution_*` events that our
`stream-adapter.ts` translates into AI SDK `tool-input-*` /
`tool-output-*` chunks (per `agent-package-spec.md` line 658-674). If
pi's events differ shape-wise from what our adapter expects, the UI may
render tool calls oddly or break.

**Mitigation:** the adapter already exists and works for our hand-rolled
tools (which emit pi-shaped events because they go through pi's tool
machinery via `customTools`). Pi's factory tools emit the same events.
No translation change needed. Verify via Step 2 smoke (direct mode)
before flipping other modes.

### R10 — `excludeDefaults` interaction with `disableDefaultFileTools`

PLUGIN_MODEL says `excludeDefaults: ['filesystem']` removes file tools
on the workspace path. This plan's `disableDefaultFileTools` opt-out
does the same on the standalone path. `createWorkspaceAgentApp` must
pass `disableDefaultFileTools: true` to `createAgentApp` (so the harness
path doesn't double-register the same file tools that the plugin path
contributes), AND also honor `excludeDefaults: ['filesystem']` (so a
host can opt out of file tools entirely even in workspace mode).

**Mitigation:** explicit test in `createWorkspaceAgentApp` that:
- Without `excludeDefaults`: file tools register exactly once (via
  plugin path; standalone path is suppressed).
- With `excludeDefaults: ['filesystem']`: zero file tools register, full
  stop.

## Test strategy

### Unit tests (per step)

- Each Operations adapter: happy path + path-bounding rejection +
  symlink-escape rejection + error-shape propagation.
- Each bundle factory: returns the right tools per mode (assert tool
  `name` array per mode; assert `vercelGrepTool` appears in
  vercel-sandbox bundle and pi's `createGrepTool` does NOT).
- `vercelGrepTool` parses ripgrep output correctly against a
  fake/recorded `sandbox.exec` response.

### Integration tests (per mode flip)

- Boot a Fastify app with `createAgentApp({ mode: '<mode>' })`,
  inject a chat request, assert the response stream includes the
  expected tool-call chunks for a known prompt. Spec line 762
  describes this pattern.
- For vercel-sandbox: use a recorded `Sandbox` mock (we already have
  some test fixtures); no real VM required for CI.

### E2E smoke (manual, per mode flip)

For each of direct/local/vercel-sandbox after its flip step:

1. Start the playground in that mode.
2. Send: "list files in the repo" → exercises `find` (or `bash ls`).
3. Send: "find all uses of `useEffect`" → exercises `grep`.
4. Send: "read package.json" → exercises `read`.
5. Send: "create a file foo.txt with content 'hi'" → exercises `write`.
6. Send: "edit foo.txt to say 'hello'" → exercises `edit`.
7. Send: "run `ls`" → exercises `bash`.
8. Verify in devtools Network: chat POST returns SSE with
   text-delta + tool-input-available + tool-output-available chunks
   for each tool used; no errors.
9. Verify in `GET /api/v1/agent/sessions/:id/system-prompt`: no
   double-dash or duplicate-guideline noise; tool names match
   `find`/`grep` (post-rename).

### Regression guards

- Snapshot test of system-prompt size: assert post-Phase-1 baseline
  is at least 700 chars smaller than the pre-Phase-1 baseline.
- Tool-renderer test: every tool name present in the bundle factories
  has a renderer entry in
  `packages/agent/src/ui-shadcn/workspaceToolRenderers.tsx`.
- A grep over `packages/` for `find_files\|grep_files` returns zero
  hits after step 6.

## Verification checklist

### After Phase 0

- [ ] `pnpm exec tsc --noEmit` clean across `packages/agent`.
- [ ] All 6 existing tool tests + new `_shared.test.ts` green.
- [ ] `bash scripts/check-invariants.sh packages/agent` passes.
- [ ] No tool file imports duplicated helpers from anywhere except
      `_shared.ts`.

### After Phase 1

- [ ] `pnpm exec tsc --noEmit` clean across `packages/agent`.
- [ ] Full `pnpm exec vitest run` green (modulo two pre-existing failures).
- [ ] `bash scripts/check-invariants.sh packages/agent` passes.
- [ ] **Direct mode smoke:** playground turn exercises bash/read/write/edit/find/grep;
      no double-dash or duplicate-guideline noise in
      `GET /api/v1/agent/sessions/:id/system-prompt`.
- [ ] **Local mode smoke:** same suite, bwrap visible in process tree
      during bash exec.
- [ ] **Vercel-sandbox mode smoke:** same suite, all tool calls hit the VM
      (verify via `sandbox.exec` log); custom `vercelGrepTool` returns
      results from inside the VM.
- [ ] System prompt size for the playground baseline drops by at least
      ~700 chars (per-tool guideline lines + double-dash slack).
- [ ] No source file under `src/server/catalog/tools/` defines `bash`,
      `read`, `write`, `edit`, `find_files`, or `grep_files`. Only
      `vercelGrepTool`, `executeIsolatedCodeTool`, and `_shared.ts` should
      remain.

## Estimated scope

### Phase 0

- New: `_shared.ts` (~80 LOC) + `_shared.test.ts` (~50 LOC).
- Touched: 6 tool files (~30-40% smaller each).
- Net: ~ **-20 LOC**.

### Phase 1

- New:
  - `operations/index.ts` (`boundFs` + vercel ops) ~180 LOC.
  - `operations.test.ts` ~150 LOC.
  - `vercelGrepTool.ts` ~80 LOC + tests ~80 LOC.
  - Per-mode tool lists ~40 LOC × 3 modes = ~120 LOC.
- Deleted:
  - 6 hand-rolled tool files ~1100 LOC.
  - 6 test files ~600 LOC.
  - `standardCatalog.ts` ~100 LOC.
  - Half of `tool-adapter.ts` ~25 LOC.
- Net: ~ **-1240 LOC**.

### Combined inventory after Phase 0 + Phase 1

| What we own | LOC |
|---|---:|
| `_shared.ts` | ~80 |
| `tools/operations/index.ts` (boundFs + vercelOps) | ~180 |
| `tools/operations.test.ts` | ~150 |
| `tools/vercelGrepTool.ts` (+ tests) | ~160 |
| `tools/executeIsolatedCodeTool.ts` (+ tests) | ~120 |
| `tool-adapter.ts` (slimmed) | ~30 |
| Per-mode tool lists | ~120 |
| **Total** | **~840 LOC** |

vs current ~1830 LOC across the same surface. **Net -990 LOC** with no
behavior change for direct/local modes, and a more correct vercel-sandbox
mode (today's hand-rolled tools don't actually route to the sandbox in the
sense pi's Operations would).

## Non-goals

- Not changing how `customTools` work for plugin tools / `extraTools`.
- Not removing path-bounding or any security guarantee. The bound moves
  from inside our hand-rolled tool to inside the Operations adapter.
- Not opting out of pi-extension tools (`web_search`, `code_search`, …).
  Tracked separately under "noExtensions knob".
- Not adding `ls` in Phase 1 (Step 6 is optional follow-up).
- Not changing the dual-registration story in PLUGIN_MODEL.md.
  PLUGIN_MODEL ships after this plan; Step 1b's bundle extraction picks up
  whatever shape `runtime/modes/*.ts` has by then — a pure file move.
- Not moving `inferBashFileChanges` out of bash. Independent PR.
- Not building a `defineTool(spec)` skeleton in Phase 0. Pi already
  provides this via TypeBox; rolling our own would die in Phase 1.

## References

- Original RFC: [pi-mono#564 — feat(coding-agent): Add pluggable operations](https://github.com/badlogic/pi-mono/issues/564)
- Canonical SSH-pattern reference: `examples/extensions/ssh.ts` in pi-coding-agent
- Canonical bwrap-pattern reference: `examples/extensions/sandbox/index.ts` in pi-coding-agent
- Why grep is default: [pi-mono#3782 — Default to using custom `grep` tool](https://github.com/badlogic/pi-mono/issues/3782)
- Active SSH-extension iteration: [pi-mono#3500](https://github.com/badlogic/pi-mono/issues/3500), [#3320](https://github.com/badlogic/pi-mono/issues/3320), [#2965](https://github.com/badlogic/pi-mono/issues/2965)
- Original spec: `packages/agent/docs/plans/agent-package-spec.md` (decisions #4, #6)
- Companion plan (lands after this): `packages/workspace/docs/plans/PLUGIN_MODEL.md`
