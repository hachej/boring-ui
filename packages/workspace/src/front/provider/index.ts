/**
 * @hachej/boring-workspace/front/provider — Provider components.
 */

export {
  WorkspaceProvider,
  ThemeProvider,
  useTheme,
  useWorkspaceBridge,
  useWorkspaceAttention,
  useWorkspaceContext,
  useWorkspaceContextOptional,
  useWorkspaceChatPanel,
} from "./WorkspaceProvider"
export type {
  WorkspaceProviderProps,
  ThemeProviderProps,
  WorkspaceBridgeContextValue,
  WorkspaceAttentionBlocker,
  WorkspaceAttentionContextValue,
  WorkspaceContextValue,
} from "./WorkspaceProvider"
export type {
  OpenArtifactHandler,
  WorkspaceChatPanelComponent,
  WorkspaceChatPanelProps,
} from "../chrome/chat/types"
