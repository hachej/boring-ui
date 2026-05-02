import { ChatPanel } from "@boring/agent"
import { WorkspaceAgentFront } from "@boring/workspace/app/front"
import {
  MacroStandaloneDeckRoute,
  macroPlugin,
  macroShellOptions,
} from "../plugins/macro/front"

export function App() {
  return (
    <MacroStandaloneDeckRoute
      fallback={
        <WorkspaceAgentFront
          chatPanel={ChatPanel}
          plugins={[macroPlugin]}
          {...macroShellOptions}
        />
      }
    />
  )
}
