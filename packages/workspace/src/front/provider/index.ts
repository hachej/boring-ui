/**
 * @hachej/boring-workspace/front/provider — Provider components.
 */

export {
  WorkspaceProvider,
  ThemeProvider,
  useTheme,
  useWorkspaceBridge,
  useWorkspaceContext,
  useWorkspaceContextOptional,
  useWorkspaceChatPanel,
} from "./WorkspaceProvider"
export type {
  WorkspaceProviderProps,
  FrontPluginHotReloadMode,
  ThemeProviderProps,
  WorkspaceBridgeContextValue,
  WorkspaceContextValue,
} from "./WorkspaceProvider"
export { formatWorkspaceDocumentTitle } from "./workspaceTitle"
export {
  WORKSPACE_ATTENTION_ACTION_EVENT,
  WorkspaceAttentionProvider,
  emitWorkspaceAttentionAction,
  useWorkspaceAttention,
  workspaceAttentionSessionBadgeForBlocker,
} from "../attention"
export type {
  WorkspaceAttentionActionDetail,
  WorkspaceAttentionBlocker,
  WorkspaceAttentionBlockerAction,
  WorkspaceAttentionContextValue,
  WorkspaceAttentionProviderProps,
  WorkspaceAttentionSessionBadge,
} from "../attention"
export type {
  OpenArtifactHandler,
  WorkspaceChatPanelComponent,
  WorkspaceChatPanelProps,
} from "../chrome/chat/types"
