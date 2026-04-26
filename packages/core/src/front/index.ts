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
} from './hooks/index.js'
export type { Binding, Breakpoint } from './hooks/index.js'

export {
  AuthProvider,
  useSession,
  useSignIn,
  useSignOut,
  UserIdentityProvider,
  useUser,
  getAuthClient,
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

export { sanitizeMarkdown, sanitizeToolOutput } from './sanitize.js'
export { debounce } from './debounce.js'
