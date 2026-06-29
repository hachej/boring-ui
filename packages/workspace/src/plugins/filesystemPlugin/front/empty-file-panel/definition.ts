import type { PanelConfig } from "../../../../shared/types/panel"
import { EmptyFilePanel } from "./EmptyFilePanel"
import { EMPTY_FILE_PANEL_ID } from "../../shared/constants"

export const emptyFilePanelDef = {
  id: EMPTY_FILE_PANEL_ID,
  title: "Unsupported file",
  component: EmptyFilePanel,
  placement: "center" as const,
  source: "builtin",
} satisfies Pick<PanelConfig, "id" | "title" | "component" | "placement" | "source">
