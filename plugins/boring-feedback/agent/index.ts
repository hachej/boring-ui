import { NoWorkspaceUiBridgeError, notify, openPanel } from "@hachej/boring-workspace/plugin"

const PLUGIN_ID = "boring-feedback"
const PANEL_ID = "boring-feedback.panel"
const COMMAND = "feedback"

type PiApi = {
  registerCommand: (
    name: string,
    options: {
      description: string
      handler: (args: string) => void | Promise<void>
    },
  ) => void
  sendUserMessage?: (content: string, options?: { deliverAs?: "steer" | "followUp" }) => void | Promise<void>
}

function feedbackPrompt(rawArgs: string): string {
  const report = rawArgs.trim()
  if (!report) {
    return [
      "Use the boring-feedback skill to start a /feedback intake.",
      "Ask me for the feedback report, then capture, enrich, redact, offer grill choices, and route it.",
      "Do not start implementation from feedback intake.",
    ].join("\n")
  }

  return [
    "Use the boring-feedback skill to process this /feedback report.",
    "",
    "Feedback report:",
    report,
    "",
    "Capture safe workspace context, show a redaction preview before publishing, offer grill choices, then create the GitHub issue or Project backlog item with the right initial status.",
    "Do not start implementation from feedback intake.",
  ].join("\n")
}

export default function boringFeedbackAgent(pi: PiApi) {
  pi.registerCommand(COMMAND, {
    description: "Capture feedback and route it through the boring feedback loop.",
    handler: async (args) => {
      let panelOpened = false

      try {
        await openPanel({
          id: `${PLUGIN_ID}.intake`,
          component: PANEL_ID,
          params: {
            report: args.trim(),
            source: `/${COMMAND}`,
          },
        })
        panelOpened = true
      } catch (error) {
        if (!(error instanceof NoWorkspaceUiBridgeError)) {
          throw error
        }
      }

      if (pi.sendUserMessage) {
        await pi.sendUserMessage(feedbackPrompt(args), { deliverAs: "followUp" })
      }

      if (panelOpened) {
        await notify("Feedback intake started.", "info").catch(() => {})
      }
    },
  })
}
