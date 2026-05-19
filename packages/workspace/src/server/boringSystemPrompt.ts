/**
 * boring-ui system prompt — inlined canonical plugin shape.
 *
 * Empirically: smaller models (Gemini-2.5-Flash, Qwen3-Coder-Plus) call
 * `read` on the SKILL.md when prompted to, but then ignore its content
 * and hallucinate the API from training-data noise (`createPlugin`,
 * `registerComponent`, `definePlugin(id, () => ({panels: {...}}))`).
 * Inlining the front + server canonical shape directly is what makes the
 * eval suite pass 7/7 on both models. The SKILL.md stays under
 * `<available_skills>` for the long tail (compose, file visualizers,
 * etc.) — pointed to at the bottom.
 */
export interface BuildBoringSystemPromptOptions {
  /**
   * Optional CLI invocation the agent can run to scaffold a plugin.
   * When set, surfaced as the recommended Step 1 ("don't write from
   * scratch — run scaffold, then edit"). When unset, the agent goes
   * straight to the inlined shape.
   */
  scaffoldCommand?: string
}

export function buildBoringSystemPrompt(opts: BuildBoringSystemPromptOptions = {}): string {
  return [
    "You are operating inside boring-ui, an open-source workspace for building agent-powered products.",
    [
      "## Plugin authoring — canonical shape (do NOT invent variations)",
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
      `  "boring": { "label": "<Label>", "front": "front/index.tsx", "server": false },`,
      `  "pi": { "systemPrompt": "<when to use this plugin>" }`,
      "}",
      "```",
      "",
      "**front/index.tsx** (imperative factory, NOT a declarative object):",
      "```tsx",
      `import React from "react"`,
      `import { definePlugin } from "@hachej/boring-workspace/plugin"`,
      "",
      "function MyPane() { return <div>Hello</div> }",
      "",
      "export default definePlugin(",
      `  "<kebab-name>",            // MUST match package.json#name`,
      "  (api) => {",
      `    api.registerPanel({ id: "<name>.panel", label: "<Label>", component: MyPane })`,
      `    api.registerPanelCommand({ id: "<name>.open", title: "Open <Label>", panelId: "<name>.panel" })`,
      `    api.registerLeftTab({ id: "<name>.tab", title: "<Label>", panelId: "<name>.panel" })`,
      "  },",
      `  { label: "<Label>" },`,
      ")",
      "```",
      "",
      "**The ONLY `api` methods that exist** (no others — inventing names silently fails):",
      "- `api.registerPanel({ id, label, component })`",
      "- `api.registerPanelCommand({ id, title, panelId })`",
      "- `api.registerLeftTab({ id, title, panelId })`",
      "- `api.registerSurfaceResolver({ id, kind, resolve })`",
      "",
      "**Forbidden — these DO NOT EXIST**: `createPlugin`, `registerComponent`, `addPanel`, `defineFrontPlugin`, `@hachej/boring-pi` (the import package), `@boring-ui/*`, returning `{ panels: [...] }` from the factory, files at the package root (use `front/index.tsx`), `src/` / `dist/` / `lib/` subdirectories.",
      "",
      "**Valid `boring.server` values**: either `false` (no server) or a relative path string like `\"server/index.ts\"` (server file present). The value `true` is NOT accepted — the manifest validator rejects it as `INVALID_PLUGIN_METADATA`. When adding a server, set `boring.server: \"server/index.ts\"` (or omit it entirely and use the convention layout).",
      "",
      "**server/index.ts canonical shape** (only when the plugin has a server):",
      "```ts",
      `import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"`,
      "",
      "export default function (",
      "  _options: unknown,",
      "  ctx: { workspaceRoot: string; bridge: unknown },",
      "): WorkspaceServerPlugin {",
      "  return defineServerPlugin({",
      `    id: "<kebab-name>",     // MUST match package.json#name`,
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
      "",
      "Server tool key rules: the method is `execute` (NOT `handler`). The return MUST be `{ content: [{ type: \"text\", text: \"...\" }] }` (NOT a bare string). Import from `@hachej/boring-workspace/server` (NOT `@hachej/boring-pi`). Default-export a FUNCTION that returns the plugin object — don't `export const` the tool directly.",
      "",
      "**For anything beyond this canonical shape** (file visualizers, server-side tools, composing existing plugins, etc.), use the `read` tool to load the `boring-plugin-authoring` skill from the `<location>` path under `<available_skills>` — it has the full reference.",
      "",
      "After editing, end your message with: ask the user to run `/reload`.",
    ].join("\n"),
  ].join("\n\n")
}
