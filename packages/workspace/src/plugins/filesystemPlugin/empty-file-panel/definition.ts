import { EmptyFilePanel } from "./EmptyFilePanel"
import { EMPTY_FILE_PANEL_ID } from "../constants"

export const emptyFilePanelDef = {
  id: EMPTY_FILE_PANEL_ID,
  title: "Unsupported file",
  component: EmptyFilePanel,
  placement: "center",
  source: "builtin",
}
