import { Sparkles } from "lucide-react"
import type { PanelConfig } from "../../registry/types"
import { SkillsPage } from "./SkillsPage"

export const WORKSPACE_SKILLS_PANEL_ID = "workspace:skills"

export const workspaceSkillsPanel: PanelConfig = {
  id: WORKSPACE_SKILLS_PANEL_ID,
  title: "Skills",
  icon: Sparkles,
  placement: "workspace-page",
  source: "core",
  component: SkillsPage,
}
