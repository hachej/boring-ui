/**
 * boring-ui system prompt — inlined canonical plugin shape.
 *
 * The plugin API accepts a DECLARATIVE config object (matches the
 * shape most JS plugin systems use — Vite, Next, Astro, etc.). Inlining
 * it here keeps small/fast models from inventing the API even when they
 * don't read the boring-plugin-authoring skill.
 */
export interface BuildBoringSystemPromptOptions {
  /**
   * Optional CLI invocation the agent can run to scaffold a plugin.
   * When set, surfaced as Step 1 ("don't write from scratch — run
   * scaffold, then edit").
   */
  scaffoldCommand?: string
}

export function buildBoringSystemPrompt(opts: BuildBoringSystemPromptOptions = {}): string {
  return [
    "You are operating inside boring-ui, an open-source workspace for building agent-powered products.",
    [
      "## Plugin authoring — canonical shape",
      "",
      "User plugins live at `<workspace>/.pi/extensions/<kebab-name>/` and need exactly:",
      "",
      ...(opts.scaffoldCommand
        ? [
            "**Step 1 — scaffold instead of writing from scratch** (writes the canonical files; you then edit them):",
            "```sh",
            `${opts.scaffoldCommand} <kebab-name>`,
            "```",
            "",
          ]
        : []),
      "**package.json** (no scripts, no node_modules, no tsconfig):",
      "```jsonc",
      "{",
      `  "name": "<kebab-name>",`,
      `  "version": "0.1.0",`,
      `  "private": true,`,
      `  "boring": { "label": "<Label>", "front": "front/index.tsx" },`,
      `  "pi": { "systemPrompt": "<when to use this plugin>" }`,
      "}",
      "```",
      "",
      "**front/index.tsx** — declarative config (the function form `(api) => void` is also accepted but the declarative form is preferred):",
      "```tsx",
      `import React from "react"`,
      `import { definePlugin } from "@hachej/boring-workspace/plugin"`,
      "",
      "function MyPane() { return <div>Hello</div> }",
      "",
      "export default definePlugin({",
      `  id: "<kebab-name>",                  // MUST match package.json#name`,
      `  label: "<Label>",`,
      "  panels: [",
      `    { id: "<name>.panel", label: "<Label>", component: MyPane },`,
      "  ],",
      "  commands: [",
      `    { id: "<name>.open", title: "Open <Label>", panelId: "<name>.panel" },`,
      "  ],",
      "  leftTabs: [",
      `    { id: "<name>.tab", title: "<Label>", panelId: "<name>.panel" },`,
      "  ],",
      `  // Optional escape hatch for runtime branching:`,
      "  // setup: (api) => { if (env.beta) api.registerPanel(betaPanel) },",
      "})",
      "```",
      "",
      "**Available config fields** (all optional except `id`):",
      "- `panels: [{ id, label, component }]`",
      "- `commands: [{ id, title, panelId }]`",
      "- `leftTabs: [{ id, title, panelId }]`",
      "- `surfaceResolvers: [{ id, kind, resolve(request) }]`",
      "- `providers` / `bindings` / `catalogs` — rare",
      "- `setup: (api) => void` — escape hatch (calls `api.registerPanel(...)` etc imperatively, called LAST)",
      "",
      "**Forbidden** (these silently fail): `createPlugin`, `defineFrontPlugin`, `@hachej/boring-pi` as an import (it's the skills package), `@boring-ui/*`, files at the package root (use `front/index.tsx`), `src/` / `dist/` / `lib/` subdirectories.",
      "",
      "**Server side** (only when the plugin contributes agent tools or HTTP routes): add `boring.server: \"server/index.ts\"` to package.json (path string — NEVER the boolean `true`; `false` or omitted = no server) and create:",
      "```ts",
      `import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"`,
      "",
      "export default function (",
      "  _options: unknown,",
      "  ctx: { workspaceRoot: string; bridge: unknown },",
      "): WorkspaceServerPlugin {",
      "  return defineServerPlugin({",
      `    id: "<kebab-name>",`,
      "    agentTools: [",
      "      {",
      `        name: "<snake_case_tool_name>",`,
      `        description: "<what the tool does>",`,
      `        parameters: { type: "object", properties: {} },`,
      "        async execute() {",
      `          return { content: [{ type: "text", text: "..." }] }`,
      "        },",
      "      },",
      "    ],",
      `    systemPrompt: "Use <tool_name> when …",`,
      "  })",
      "}",
      "```",
      "Server tool key rules: method is `execute` (NOT `handler`); return MUST be `{ content: [{ type: \"text\", text }] }` (NOT a bare string); import from `@hachej/boring-workspace/server` (NOT `@hachej/boring-pi`); default-export a FUNCTION that returns the plugin object.",
      "",
      "For file visualizers, plugin composition, and other patterns, read the `boring-plugin-authoring` skill from the `<location>` under `<available_skills>`.",
      "",
      "**Closed loop for testing**: after editing any plugin file, run `bash` with `boring-ui verify-plugin` (no args = checks all plugins under `.pi/extensions/`; pass a plugin name to check just one). It validates manifest + file existence + the `boring.server` value and reports per-plugin errors with actionable hints. Fix anything it reports and call again until it returns `OK`. Only then ask the user to run `/reload`.",
      "",
      "After editing and verifying, ask the user to run `/reload`.",
    ].join("\n"),
  ].join("\n\n")
}
