/**
 * boring-ui system prompt — numbered TODO workflow with the canonical
 * plugin shape inlined.
 *
 * Tried shrinking this to a pure TODO with no inline canonical (just
 * scaffold → edit → verify → /reload pointers). Both Gemini-2.5-Flash
 * and Qwen3.6-Plus regressed to ~4-6 of 7 evals across runs — drifting
 * back to invented APIs, wrong file paths, or skipping the customize
 * step after scaffold. The inlined shape is what anchors reliability
 * across runs; the TODO numbering is what makes the workflow legible.
 */
export interface BuildBoringSystemPromptOptions {
  /**
   * Optional scaffold CLI invocation (e.g. `boring-ui scaffold-plugin`
   * or `npx @hachej/boring-ui-cli scaffold-plugin`). When set, step 1
   * becomes "scaffold then edit"; when unset, step 1 is "create the
   * plugin files from scratch".
   */
  scaffoldCommand?: string
  /**
   * Optional verify CLI invocation. Defaults to
   * `boring-ui verify-plugin`. Set to `false` to drop the verify step.
   */
  verifyCommand?: string | false
}

export function buildBoringSystemPrompt(opts: BuildBoringSystemPromptOptions = {}): string {
  const verify = opts.verifyCommand === undefined ? "boring-ui verify-plugin" : opts.verifyCommand
  const steps: string[] = []
  let n = 0

  if (opts.scaffoldCommand) {
    n += 1
    steps.push(
      `**${n}. Scaffold.** Bash \`${opts.scaffoldCommand} <kebab-name>\` — writes the canonical \`package.json\` + \`front/index.tsx\` under \`<cwd>/.pi/extensions/<kebab-name>/\`. Then read the two generated files.`,
    )
  }

  n += 1
  const editStep = opts.scaffoldCommand
    ? `**${n}. Edit the generated files to implement what the user actually asked for.** The scaffolded files are a stub — you MUST replace the placeholder content (the default "Hello" pane, default ids/labels) with the real implementation.`
    : `**${n}. Create the plugin files** under \`<cwd>/.pi/extensions/<kebab-name>/\` (never the package root or \`src/\` / \`dist/\`).`
  steps.push(
    [
      editStep,
      "",
      "Canonical `front/index.tsx`:",
      "```tsx",
      `import { definePlugin } from "@hachej/boring-workspace/plugin"`,
      "",
      "function MyPane() { return <div>Hello</div> }",
      "",
      "export default definePlugin({",
      `  id: "<kebab-name>",        // MUST match package.json#name`,
      `  label: "<Label>",`,
      `  panels: [{ id: "<name>.panel", label: "<Label>", component: MyPane }],`,
      `  commands: [{ id: "<name>.open", title: "Open <Label>", panelId: "<name>.panel" }],`,
      `  leftTabs: [{ id: "<name>.tab", title: "<Label>", panelId: "<name>.panel" }],`,
      "  // surfaceResolvers, providers, bindings, catalogs, setup (escape hatch) — all optional",
      "})",
      "```",
      "",
      "Canonical `package.json`: declares `name` (must match `definePlugin({id})`), `boring.front` (path string), optional `boring.server` (string path like `\"server/index.ts\"` — NEVER the boolean `true`), optional `pi.systemPrompt` (when-to-use hint).",
      "",
      "**For agent tools / HTTP routes**, add `server/index.ts`:",
      "```ts",
      `import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"`,
      "",
      "export default function (",
      "  _options: unknown,",
      "  ctx: { workspaceRoot: string; bridge: unknown },",
      "): WorkspaceServerPlugin {",
      "  return defineServerPlugin({",
      `    id: "<kebab-name>",`,
      "    agentTools: [{",
      `      name: "<snake_case_tool_name>",`,
      `      description: "<what the tool does>",`,
      `      parameters: { type: "object", properties: {} },`,
      "      async execute() {",
      `        return { content: [{ type: "text", text: "..." }] }`,
      "      },",
      "    }],",
      `    systemPrompt: "Use <tool_name> when …",`,
      "  })",
      "}",
      "```",
      "Tool method is `execute` (NOT `handler`); return `{ content: [{ type: \"text\", text }] }` (NOT a bare string); set `boring.server: \"server/index.ts\"` in package.json.",
      "",
      "**Forbidden** (these DO NOT EXIST): `createPlugin`, `defineFrontPlugin`, `registerComponent`, `addPanel`, `@hachej/boring-pi` as an import, `@boring-ui/*`, files at the package root, `boring.server: true`.",
    ].join("\n"),
  )

  if (verify) {
    n += 1
    steps.push(
      `**${n}. Verify.** Bash \`${verify}\` — validates every plugin under \`<cwd>/.pi/extensions/\` and prints per-plugin errors with actionable hints. Read the output carefully: if it WARNs about an empty/missing dir, your plugin files went to the wrong cwd. Fix what it reports and re-run until it returns \`OK\`. Use this after EVERY plugin edit.`,
    )
  }

  n += 1
  steps.push(`**${n}. Ask the user to run \`/reload\`** to publish the change.`)

  return [
    "You are operating inside boring-ui, an open-source workspace for building agent-powered products.",
    [
      "## Plugin authoring — required workflow",
      "",
      ...steps,
      "",
      "For file visualizers, plugin composition, providers/bindings/catalogs, conditional registration via `setup`, or deeper server-tool patterns: read the `boring-plugin-authoring` skill from the `<location>` under `<available_skills>`.",
    ].join("\n"),
  ].join("\n\n")
}
