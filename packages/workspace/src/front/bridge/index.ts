export { createBridge } from "./createBridge"
export { createBridgeClient } from "./client"
export type { BridgeClient, BridgeClientOptions, UIStatePut } from "./client"
export type {
  WorkspaceBridge,
  BridgeEventMap,
  CommandResult,
  DynamicPaneConfig,
  Unsubscribe,
  CausedBy,
} from "./types"
export {
  openFileSchema,
  openPanelSchema,
  closePanelSchema,
  notificationSchema,
  navigateToLineSchema,
  expandToFileSchema,
  MAX_PANELS,
} from "./validation"
