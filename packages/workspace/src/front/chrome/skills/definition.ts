import { Bot } from "lucide-react"
import type { PanelConfig } from "../../registry/types"
import { AgentPage } from "./AgentPage"

export const WORKSPACE_AGENT_PANEL_ID = "workspace:agent"

export const workspaceAgentPanel: PanelConfig = {
  id: WORKSPACE_AGENT_PANEL_ID,
  title: "Agent",
  icon: Bot,
  placement: "workspace-page",
  source: "core",
  component: AgentPage,
}
