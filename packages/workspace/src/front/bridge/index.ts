export { createBridge } from "./createBridge"
export { createBridgeClient } from "./client"
export { dispatchUiCommand, WORKSPACE_COMMAND_NOTIFY_EVENT, WORKSPACE_SURFACE_OPEN_SKIPPED_EVENT } from "./uiCommandDispatcher"
export { UI_COMMAND_EVENT, postUiCommand } from "./uiCommandBus"
export { WorkspaceLink, workspaceLinkCommand, workspaceLinkHref } from "./WorkspaceLink"
export type { WorkspaceLinkProps, WorkspaceLinkTarget } from "./WorkspaceLink"
export { startUiCommandStream } from "./uiCommandStream"
export type { BridgeClient, BridgeClientOptions, UIStatePut } from "./client"
export type { DispatchContext } from "./uiCommandDispatcher"
export type { UiCommand } from "./types"
export type {
  WorkspaceBridge,
  FileTreeBridge,
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
