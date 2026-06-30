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
  WorkspaceAttentionInboxSourceMetadata,
  WorkspaceAttentionSessionBadge,
} from "../attention"
export {
  WorkspaceHumanActionTargetButtons,
  WorkspaceHumanActionTargetsProvider,
  useWorkspaceHumanActionsForTarget,
  useWorkspaceHumanActionTargets,
  workspaceHumanActionTargetKey,
} from "../humanActions"
export type {
  WorkspaceHumanActionButton,
  WorkspaceHumanActionTargetAction,
  WorkspaceHumanActionTargetRef,
  WorkspaceHumanActionTargetsContextValue,
} from "../humanActions"
export type {
  OpenArtifactHandler,
  WorkspaceChatPanelComponent,
  WorkspaceChatPanelProps,
} from "../chrome/chat/types"
