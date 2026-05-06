import { ChatPanel } from "@boring/agent"
import type { SlashCommand } from "@boring/agent"
import { CoreWorkspaceAgentFront } from "@boring/core/app/front"
import {
  macroPlugin,
  macroShellOptions,
} from "../plugins/macro/front"

const MACRO_SKILL_COMMANDS: SlashCommand[] = [
  {
    name: "macro-deck",
    description: "Create or edit a macro briefing deck with embedded charts",
    kind: "skill",
    handler: () => {},
  },
  {
    name: "macro-transform",
    description: "Create a derived macro series with Python (YoY, MA, diff, …)",
    kind: "skill",
    handler: () => {},
  },
]

const { chatParams } = macroShellOptions

export function App() {
  return (
    <CoreWorkspaceAgentFront
      chatPanel={ChatPanel}
      plugins={[macroPlugin]}
      extraCommands={MACRO_SKILL_COMMANDS}
      appTitle="boring.macro"
      apiBaseUrl=""
      apiTimeout={10000}
      persistenceEnabled={true}
      chatParams={chatParams}
    />
  )
}
