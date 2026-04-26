export { AppErrorBoundary } from './AppErrorBoundary.js'
export { ThemeProvider, useTheme } from './ThemeProvider.js'
export type { ThemeApi, ThemeProviderProps } from './ThemeProvider.js'

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
