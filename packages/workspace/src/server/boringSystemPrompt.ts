import { createRequire } from "node:module"
import { dirname, join } from "node:path"

/**
 * boring-ui system prompt — workflow steps + a Pi-style docs pointer
 * block (per DECISIONS.md #17). The block lists workspace-readable paths
 * into the installed `@hachej/boring-pi` package so the agent's `read` tool
 * can fetch the SKILL.md + reference docs on demand, without inlining their
 * ~12-30 KB of markdown into every system prompt.
 *
 * `@hachej/boring-pi` is a runtime dep of `@hachej/boring-workspace`;
 * a missing install means the host shipped without it (degraded mode),
 * in which case we still emit the workflow + skill-by-name reference
 * for `<available_skills>` consumers but skip the absolute paths.
 */
export interface BuildBoringSystemPromptOptions {
  /**
   * CLI invocation that writes the canonical files (e.g.
   * `boring-ui-plugin scaffold`). When unset, step 1 falls back to
   * "read the skill" — the agent then has no canonical anchor and
   * reliability suffers on smaller models, so always provide this in
   * production.
   */
  scaffoldCommand?: string
  /** CLI invocation that validates `.pi/extensions/*` manifests. Omit when unavailable. */
  verifyCommand?: string
  /**
   * Test escape hatch. Overrides the runtime `require.resolve` of
   * `@hachej/boring-pi/package.json`:
   *   - `undefined` (default): resolve via require.resolve
   *   - `string`: use as the boring-pi root verbatim
   *   - `null`: force the degraded path (no resolution attempt)
   * Production should leave unset.
   */
  boringPiRootOverride?: string | null
}

const require = createRequire(import.meta.url)

function resolveBoringPiRoot(override: string | null | undefined): string | null {
  if (override === null) return null
  if (override) return override
  try { return dirname(require.resolve("@hachej/boring-pi/package.json")) }
  catch { return null }
}

interface DocsRef {
  topic: string
  path: string
}

function buildDocsRefs(boringPiRoot: string): DocsRef[] {
  return [
    { topic: "Workflow + how-to + full plugin authoring reference",
      path: join(boringPiRoot, "skills/boring-plugin-authoring/SKILL.md") },
    { topic: "Panels (registration, dockview, layout)",
      path: join(boringPiRoot, "references/workspace/panels.md") },
    { topic: "Bridge / UI control (get_ui_state, exec_ui)",
      path: join(boringPiRoot, "references/workspace/bridge.md") },
    { topic: "Server plugins (defineServerPlugin, routes, agent tools)",
      path: join(boringPiRoot, "references/workspace/plugins.md") },
  ]
}

export function buildBoringSystemPrompt(opts: BuildBoringSystemPromptOptions): string {
  const verify = opts.verifyCommand
  const boringPiRoot = resolveBoringPiRoot(opts.boringPiRootOverride)
  const steps: string[] = []
  let n = 0

  if (opts.scaffoldCommand) {
    n += 1
    steps.push(
      `**${n}. Check plugin-root support, then scaffold.** Bash \`boring-ui-plugin status --json\`; continue only if \`workspaceLocalPluginRoots\` is \`true\`. Then bash \`${opts.scaffoldCommand} <kebab-name> "$BORING_AGENT_WORKSPACE_ROOT"\`. Read generated \`package.json\` + \`front/index.tsx\`; do NOT write from memory.`,
    )
  } else {
    n += 1
    steps.push(
      `**${n}. Read the \`boring-plugin-authoring\` skill** from the \`<location>\` listed under \`<available_skills>\` for the canonical \`package.json\` + \`front/index.tsx\` shape.`,
    )
  }

  n += 1
  steps.push(
    opts.scaffoldCommand
      ? `**${n}. Edit the generated files.** Keep scaffold imports/layout. Use \`@hachej/boring-ui-kit\` + workspace primitives for native UI; avoid ad-hoc inline UI.`
      : `**${n}. Create or edit plugin files.** Use the boring-plugin-authoring skill for imports, \`definePlugin\`, manifest layout, and boring-ui-kit design defaults.`,
  )

  n += 1
  steps.push(
    `**${n}. Install plugin-local deps only when needed.** If adding a browser package, bash \`cd "$BORING_AGENT_WORKSPACE_ROOT/.pi/extensions/<kebab-name>" && npm install <dep>\`; never install at workspace root. \`/reload\` never installs packages.`,
  )

  n += 1
  if (verify) {
    steps.push(
      `**${n}. Verify.** Bash \`${verify} <kebab-name> "$BORING_AGENT_WORKSPACE_ROOT"\`. If it warns about empty/missing dirs, your files went to the wrong cwd. Fix issues and re-run until \`OK\`. Use after EVERY edit.`,
    )
  } else {
    steps.push(
      `**${n}. Verify.** The boring-ui CLI is not available in this host, so do not invent CLI commands. Validate by re-reading the manifest/front files against the boring-plugin-authoring skill, then ask the user to run \`/reload\` and inspect reload diagnostics.`,
    )
  }

  n += 1
  steps.push(`**${n}. Ask the user to run \`/reload\`** to publish the change.`)

  const docsBlock = boringPiRoot
    ? [
        "## boring-ui plugin authoring documentation",
        "Read these only when the user asks to build, modify, or debug a workspace plugin. Use your `read` tool with these workspace-relative paths; the agent runtime guarantees they exist inside `$BORING_AGENT_WORKSPACE_ROOT`:",
        ...buildDocsRefs(boringPiRoot).map((r) => `- ${r.topic}: ${r.path}`),
        "Follow .md cross-references when present (e.g. SKILL.md may link to a reference doc — read both).",
      ].join("\n")
    : [
        "## boring-ui plugin authoring documentation",
        "The `boring-plugin-authoring` skill listed under `<available_skills>` is the authoritative reference (read its `<location>`). Additional reference docs (`panels.md`, `bridge.md`, `plugins.md`) are unavailable on this host — `@hachej/boring-pi` is not installed.",
      ].join("\n")

  return [
    "You are operating inside boring-ui. Before `.pi/extensions/<name>/`, run `boring-ui-plugin status --json`; continue only when `workspaceLocalPluginRoots` is `true`. Default to `.pi/extensions/<name>/`. Global `~/.pi/agent/extensions/` only for explicit requests.",
    [
      "## Plugin authoring — required workflow",
      "",
      ...steps,
      "",
      "**Common hallucinations** — these names DO NOT EXIST in boring-ui and will silently fail; do not write them:",
      "- API factories: `createPlugin`, `defineFrontPlugin`, `defineComponent` — use `definePlugin({id, panels, commands, ...})` from `@hachej/boring-workspace/plugin`.",
      "- Imperative method names: `registerComponent`, `addPanel`, `registerCommand` (no `Panel`), `registerTab` — the actual names are `registerPanel`, `registerPanelCommand`, `registerLeftTab`, `registerSurfaceResolver` (and you usually express these declaratively, not as method calls).",
      "- Import paths: `@hachej/boring-pi` (it's a skills package, not for code), `@boring-ui/*`, `@hachej/pi-sdk` — use `@hachej/boring-workspace/plugin` for front and `@hachej/boring-workspace/server` for server.",
      "- File visualizers: import `WORKSPACE_OPEN_PATH_SURFACE_KIND`/`PaneProps` from `@hachej/boring-workspace/plugin`; import `useApiBaseUrl`/`useWorkspaceRequestId` from `@hachej/boring-workspace`; read `request.target`; fetch `${apiBaseUrl}/api/v1/files/raw?...` with `credentials: \"include\"` and `x-boring-workspace-id` when present. Never use `/workspace/read` or string kind `\"WORKSPACE_OPEN_PATH_SURFACE_KIND\"`.",
      "- Pi extension tools: `defineTool` and `export const tools` do NOT exist. Export `default function (pi) { pi.registerTool({ name, description, parameters: { type: \"object\", properties: {} }, execute }) }`. `parameters` is mandatory even for no-arg tools; omitting it breaks tool execution.",
      "- Server/Pi tool method: `handler` — use `execute`. Return shape: `{ content: [{ type: \"text\", text }] }` (NEVER a bare string).",
      "- Manifest values: `boring.server: true` — use `false`/omit for hot-reload user plugins, or a relative path string only for advanced boot-time/static server integration.",
      "- File layout: files at the package root, or `src/` / `dist/` / `lib/` subdirectories — the scaffold's hot-reload layout (`front/index.tsx`, optional `agent/index.ts` declared in `pi.extensions`) is the one the workspace refreshes on `/reload`.",
      "- Dependency installs: do NOT install plugin UI dependencies at the workspace root. Install them inside `.pi/extensions/<name>/` and keep React/workspace/boring-ui-kit imports as host singletons, not plugin dependencies.",
      "- Hot-reload agent tools: do NOT put them in `.pi/extensions/<name>/server/index.ts`; use `pi.extensions` instead. `boring.server` requires static composition plus process restart.",
    ].join("\n"),
    [
      "## Installing an existing or published plugin",
      "To ADD an existing or published plugin (not author a new one), use `boring-ui-plugin install <source>` via bash — `<source>` is `npm:<package>`, `git:<repo>`, `github:<owner>/<repo>`, an `http(s)` git URL, or a local path; add `--global` for all workspaces (default is this workspace).",
      "A bare `npm install <package>` does NOT register it as a plugin (no `.pi/settings.json` package source), so it will NOT load — always use `boring-ui-plugin install`, then ask the user to `/reload` (a `boring.server` backend also needs a process restart).",
      "Inspect with `boring-ui-plugin list [--json]`; remove with `boring-ui-plugin remove <id-or-source>`.",
    ].join("\n"),
    docsBlock,
  ].join("\n\n")
}
