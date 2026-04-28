export { AppErrorBoundary } from './AppErrorBoundary.js'
export { ConfigProvider, useConfig, useConfigLoaded } from './ConfigProvider.js'
export type { ConfigProviderProps } from './ConfigProvider.js'
export { ThemeProvider } from './ThemeProvider.js'
export type { ThemeApi, ThemeProviderProps } from './ThemeProvider.js'
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
} from './WorkspaceAuthProvider.js'
export type { WorkspaceAuthProviderProps } from './WorkspaceAuthProvider.js'

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
  SignInPage,
  SignUpPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
  UserSettingsPage,
} from './auth/index.js'
export type {
  AuthProviderProps,
  UserIdentity,
  UserIdentityProviderProps,
  AuthClient,
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

export { BoringApp } from './BoringApp.js'
export type { BoringAppProps, BoringAppAuthPagesOverride } from './BoringApp.js'

export { InvitesPage } from './workspace/InvitesPage.js'

export {
  UserMenu,
  TopBarSlotProvider,
  useTopBarSlot,
  WorkspaceSwitcher,
  ThemeToggle,
} from './components/index.js'

export { sanitizeMarkdown, sanitizeToolOutput } from './sanitize.js'
export { debounce } from './debounce.js'
