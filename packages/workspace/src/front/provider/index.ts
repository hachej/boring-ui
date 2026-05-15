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
  ThemeProviderProps,
  WorkspaceBridgeContextValue,
  WorkspaceContextValue,
} from "./WorkspaceProvider"
export {
  WorkspaceAttentionProvider,
  useWorkspaceAttention,
} from "../attention"
export type {
  WorkspaceAttentionBlocker,
  WorkspaceAttentionContextValue,
} from "../attention"
export type {
  OpenArtifactHandler,
  WorkspaceChatPanelComponent,
  WorkspaceChatPanelProps,
} from "../chrome/chat/types"
