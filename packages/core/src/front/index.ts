export { AppErrorBoundary } from './AppErrorBoundary.js'
export { ConfigProvider, useConfig, useConfigLoaded } from './ConfigProvider.js'
export type { ConfigProviderProps } from './ConfigProvider.js'
export { ThemeProvider } from './ThemeProvider.js'
export type { ThemeApi, ThemeProviderProps } from './ThemeProvider.js'
export { CompanyAdminProvider, useCompanyAdminStatus } from './CompanyAdminProvider.js'
export type {
  CompanyAdminLabels,
  CompanyAdminProviderProps,
  CompanyAdminStatus,
  LoadCompanyAdminStatus,
  RenderCompanyAdminContent,
} from './CompanyAdminProvider.js'
export {
  useTheme,
  useKeyboardShortcuts,
  useViewportBreakpoint,
  useReducedMotion,
  useBlobUrl,
  useCapabilities,
  useWorkspaceMembers,
} from './hooks/index.js'
export type { Binding, Breakpoint, EnrichedMember } from './hooks/index.js'

export {
  WorkspaceAuthProvider,
  useCurrentWorkspace,
  useWorkspaceRole,
  useWorkspaceRouteStatus,
} from './WorkspaceAuthProvider.js'
export type { WorkspaceAuthProviderProps, WorkspaceRouteStatus } from './WorkspaceAuthProvider.js'

export {
  AuthProvider,
  useSession,
  useSignIn,
  useSignUp,
  useSignOut,
  useVerifyEmail,
  useSendVerificationEmail,
  useChangePassword,
  UserIdentityProvider,
  useUser,
  getAuthClient,
  GoogleAuthButton,
  SignInPage,
  SignUpPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
  UserSettingsPage,
  InviteAcceptPage,
} from './auth/index.js'
export type {
  AuthProviderProps,
  UserIdentity,
  UserIdentityProviderProps,
  AuthClient,
  GoogleAuthButtonProps,
} from './auth/index.js'

export {
  apiFetch,
  apiFetchJson,
  getApiBase,
  setApiBase,
  buildApiUrl,
  getWsBase,
  buildWsUrl,
  openWebSocket,
  getHttpErrorDetail,
  routes,
  routeHref,
} from './utils.js'
export type { RouteMap } from './utils.js'

export { AuthGate } from './AuthGate.js'
export type { AuthGateProps } from './AuthGate.js'

export { CoreFront } from './CoreFront.js'
export type { CoreFrontProps, CoreFrontAuthPagesOverride, CoreFrontCompanyAdminOptions } from './CoreFront.js'

export { useCoreCommands } from './commands/CoreCommandContributions.js'
export type { CoreCommand } from './commands/CoreCommandContributions.js'

export { InvitesPage } from './workspace/InvitesPage.js'
export { MembersPage } from './workspace/MembersPage.js'
export { WorkspaceSettingsPage } from './workspace/WorkspaceSettingsPage.js'
export { CompanyAdminPage } from './workspace/CompanyAdminPage.js'
export { getWorkspaceCommands } from './workspace/commands.js'
export type { WorkspaceCommand } from './workspace/commands.js'

export {
  UserMenu,
  TopBarSlotProvider,
  useTopBarSlot,
  WorkspaceSwitcher,
  CreateWorkspaceDialog,
  ThemeToggle,
} from './components/index.js'
export type { CreateWorkspaceDialogProps } from './components/index.js'

export { sanitizeMarkdown, sanitizeToolOutput } from './sanitize.js'
export { debounce } from './debounce.js'
