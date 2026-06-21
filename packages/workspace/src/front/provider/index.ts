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
  WorkspaceAttentionProvider,
  useWorkspaceAttention,
} from "../attention"
export type {
  WorkspaceAttentionBlocker,
  WorkspaceAttentionContextValue,
  WorkspaceAttentionSessionBadge,
} from "../attention"
export type {
  OpenArtifactHandler,
  WorkspaceChatPanelComponent,
  WorkspaceChatPanelProps,
} from "../chrome/chat/types"
