import { createRequire } from "node:module"
import { dirname, join } from "node:path"

/**
 * boring-ui system prompt — workflow steps + a Pi-style docs pointer
 * block (per DECISIONS.md #17). The block lists absolute paths into the
 * installed `@hachej/boring-pi` package so the agent's `read` tool can
 * fetch the SKILL.md + reference docs on demand, without inlining their
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
   * `boring-ui scaffold-plugin`). When unset, step 1 falls back to
   * "read the skill" — the agent then has no canonical anchor and
   * reliability suffers on smaller models, so always provide this in
   * production.
   */
  scaffoldCommand?: string
  /** CLI invocation that validates `.pi/extensions/*` manifests. */
  verifyCommand: string
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
      `**${n}. Scaffold.** Bash \`${opts.scaffoldCommand} <kebab-name>\` — writes the canonical \`package.json\` + \`front/index.tsx\` under \`<cwd>/.pi/extensions/<kebab-name>/\`. Read the two generated files to learn the exact shape (\`definePlugin({...})\`, manifest fields, import paths). Do NOT skip this step and write from training-data memory.`,
    )
  } else {
    n += 1
    steps.push(
      `**${n}. Read the \`boring-plugin-authoring\` skill** from the \`<location>\` listed under \`<available_skills>\` for the canonical \`package.json\` + \`front/index.tsx\` shape.`,
    )
  }

  n += 1
  steps.push(
    `**${n}. Edit the generated files to implement what the user asked for.** Keep the imports, the \`definePlugin\` call shape, and the manifest layout from the scaffold — only change the placeholder content (default "Hello" pane, default ids/labels, sample comments) into the real implementation.`,
  )

  n += 1
  steps.push(
    `**${n}. Verify.** Bash \`${verify}\` — validates every plugin under \`<cwd>/.pi/extensions/\` and prints per-plugin errors with actionable hints. Read the output: if it WARNs about an empty/missing dir, your plugin files went to the wrong cwd. Fix what it reports and re-run until it returns \`OK\`. Use this after EVERY edit.`,
  )

  n += 1
  steps.push(`**${n}. Ask the user to run \`/reload\`** to publish the change.`)

  const docsBlock = boringPiRoot
    ? [
        "## boring-ui plugin authoring documentation",
        "Read these only when the user asks to build, modify, or debug a workspace plugin. Use your `read` tool with the absolute path; the agent runtime guarantees these files exist on the host:",
        ...buildDocsRefs(boringPiRoot).map((r) => `- ${r.topic}: ${r.path}`),
        "Follow .md cross-references when present (e.g. SKILL.md may link to a reference doc — read both).",
      ].join("\n")
    : [
        "## boring-ui plugin authoring documentation",
        "The `boring-plugin-authoring` skill listed under `<available_skills>` is the authoritative reference (read its `<location>`). Additional reference docs (`panels.md`, `bridge.md`, `plugins.md`) are unavailable on this host — `@hachej/boring-pi` is not installed.",
      ].join("\n")

  return [
    "You are operating inside boring-ui, an open-source workspace for building agent-powered products.",
    [
      "## Plugin authoring — required workflow",
      "",
      ...steps,
      "",
      "**Common hallucinations** — these names DO NOT EXIST in boring-ui and will silently fail; do not write them:",
      "- API factories: `createPlugin`, `defineFrontPlugin`, `defineComponent` — use `definePlugin({id, panels, commands, ...})` from `@hachej/boring-workspace/plugin`.",
      "- Imperative method names: `registerComponent`, `addPanel`, `registerCommand` (no `Panel`), `registerTab` — the actual names are `registerPanel`, `registerPanelCommand`, `registerLeftTab`, `registerSurfaceResolver` (and you usually express these declaratively, not as method calls).",
      "- Import paths: `@hachej/boring-pi` (it's a skills package, not for code), `@boring-ui/*`, `@hachej/pi-sdk` — use `@hachej/boring-workspace/plugin` for front and `@hachej/boring-workspace/server` for server.",
      "- Server tool method: `handler` — use `execute`. Return shape: `{ content: [{ type: \"text\", text }] }` (NEVER a bare string).",
      "- Manifest values: `boring.server: true` — use `false`/omit for hot-reload user plugins, or a relative path string only for advanced boot-time/static server integration.",
      "- File layout: files at the package root, or `src/` / `dist/` / `lib/` subdirectories — the scaffold's hot-reload layout (`front/index.tsx`, optional `agent/index.ts` declared in `pi.extensions`) is the one the workspace refreshes on `/reload`.",
      "- Hot-reload agent tools: do NOT put them in `.pi/extensions/<name>/server/index.ts`; use `pi.extensions` instead. `boring.server` requires static composition plus process restart.",
    ].join("\n"),
    docsBlock,
  ].join("\n\n")
}
