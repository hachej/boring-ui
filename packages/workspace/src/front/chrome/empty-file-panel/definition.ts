import { definePanel } from "../../registry/types"
import { EmptyFilePanel } from "./EmptyFilePanel"

export const emptyFilePanelDef = definePanel<{ path: string }>({
  id: "empty-file-panel",
  title: "Unsupported file",
  component: EmptyFilePanel,
  source: "builtin",
})
