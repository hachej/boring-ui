// Re-export shared types — front may extend or add runtime helpers here
export type {
  PaneProps,
  PanelConfig,
  CommandConfig,
  PanelRegistration,
} from "../../shared/types/panel"

// definePanel is a runtime value, not a type
export { definePanel } from "../../shared/types/panel"
