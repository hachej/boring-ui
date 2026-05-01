import type { PanelConfig } from "./types"
import { chatPanel } from "../chrome/chat/definition"
import { sessionListPanel } from "../chrome/session-list/definition"
import { workbenchLeftPanel } from "../chrome/workbench-left/definition"
import { artifactSurfacePanel } from "../chrome/artifact-surface/definition"

export const coreWorkspacePanels: PanelConfig[] = [
  chatPanel,
  sessionListPanel,
  workbenchLeftPanel,
  artifactSurfacePanel,
]
