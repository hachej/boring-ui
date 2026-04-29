export { SessionBrowser } from "../../chrome/session-list/SessionBrowser"
export type { SessionBrowserProps } from "../../chrome/session-list/SessionBrowser"
export { ChatStagePlaceholder } from "../../chrome/chat-stage-placeholder/ChatStagePlaceholder"
export type { ChatStagePlaceholderProps, ChatStageHandle } from "../../chrome/chat-stage-placeholder/ChatStagePlaceholder"
export { SurfaceShell } from "../../chrome/artifact-surface/SurfaceShell"
export type { SurfaceShellProps, SurfaceShellApi, SurfaceShellSnapshot, SurfaceShellTab, OpenPanelConfig } from "../../chrome/artifact-surface/SurfaceShell"
export { WorkbenchLeftPane } from "../../chrome/workbench-left/WorkbenchLeftPane"
export type {
  WorkbenchLeftPaneProps,
  WorkbenchLeftTab,
  DataSource,
  DataPaneConfig,
} from "../../chrome/workbench-left/WorkbenchLeftPane"
export { ChatCenteredShell } from "./ChatCenteredShell"
export type { ChatCenteredShellProps } from "./ChatCenteredShell"
export { ChatShellContext, useChatShell, useChatSurface } from "./context"
export type { ChatShellContextValue } from "./context"
