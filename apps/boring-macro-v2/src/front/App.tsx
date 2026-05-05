import { ChatPanel } from "@boring/agent"
import type { SlashCommand } from "@boring/agent"
import { WorkspaceAgentFront } from "@boring/workspace/app/front"
import {
  MacroStandaloneDeckRoute,
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

export function App() {
  return (
    <MacroStandaloneDeckRoute
      fallback={
        <WorkspaceAgentFront
          chatPanel={ChatPanel}
          plugins={[macroPlugin]}
          extraCommands={MACRO_SKILL_COMMANDS}
          {...macroShellOptions}
        />
      }
    />
  )
}
