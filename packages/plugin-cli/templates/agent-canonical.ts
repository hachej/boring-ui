// CANONICAL agent/index.ts for a boring-ui runtime plugin.
// Registers a hot-reloadable Pi slash command for deterministic plugin activation.
//
// The command opens its panel through the in-process workspace UI bridge via
// `openPanel` from "@hachej/boring-workspace/plugin" — the SAME path the agent's
// own `exec_ui` tool uses. No BORING_UI_URL, no env vars, no HTTP self-call:
// the bridge is already connected to the browser.

import { NoWorkspaceUiBridgeError, notify, openPanel } from "@hachej/boring-workspace/plugin"

const PLUGIN_ID = "<kebab-name>"
const PANEL_ID = "<kebab-name>.panel"
const PANEL_TITLE = "<Label>"
const OPEN_COMMAND = "open-<kebab-name>"

export default function (pi: any) {
  // User-facing deterministic slash command. Add pi.registerTool(...) below
  // when this plugin also needs an LLM-callable tool.
  pi.registerCommand(OPEN_COMMAND, {
    description: `Open the ${PANEL_TITLE} panel`,
    handler: async () => {
      try {
        await openPanel({
          id: `${PLUGIN_ID}.slash-open`,
          component: PANEL_ID,
          params: { source: `/${OPEN_COMMAND}` },
        })
        // Surfaces as a workspace toast (unlike Pi's ctx.ui.notify, which is a
        // terminal notification that is swallowed in server/headless mode).
        await notify(`Opened ${PANEL_TITLE}.`, "info")
      } catch (error) {
        if (error instanceof NoWorkspaceUiBridgeError) {
          // Running outside a workspace agent (e.g. a bare Pi CLI). Nothing to
          // open; rethrow so the caller logs a clear reason.
          throw error
        }
        await notify(
          `Could not open ${PANEL_TITLE}: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        ).catch(() => {})
        throw error
      }
    },
  })
}
