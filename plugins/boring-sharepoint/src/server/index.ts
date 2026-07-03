import { createSharePointServerPlugin } from "./serverPlugin"

export default createSharePointServerPlugin

export {
  BORING_SHAREPOINT_PLUGIN_ID,
  BORING_SHAREPOINT_PLUGIN_LABEL,
} from "../shared"
export {
  ARCADE_ENV_KEYS,
  loadArcadeSharePointRuntimeConfig,
  redactArcadeConfigForLog,
  redactArcadeSecret,
  requireArcadeSharePointRuntimeConfig,
  type ArcadeSharePointRuntimeConfig,
  type ArcadeSharePointRuntimeConfigInput,
} from "./arcadeConfig"
export {
  normalizeArcadeAuthState,
  normalizeArcadeToolAuthState,
} from "./authNormalization"
export {
  ArcadeJsToolRuntime,
  type ArcadeAuthorizationInput,
  type ArcadeAuthorizationStatusInput,
  type ArcadeToolExecuteInput,
} from "./arcadeRuntime"
export {
  SHAREPOINT_ROUTE_PATHS,
  sharePointRoutes,
  type SharePointRoutesOptions,
} from "./routes"
export {
  createSharePointServerPlugin,
  type SharePointServerPluginOptions,
} from "./serverPlugin"
export {
  ARCADE_SHAREPOINT_TOOL_NAMES,
  ArcadeSharePointProvider,
  SharePointProviderError,
  toSharePointDocumentRef,
  type ArcadeSharePointProviderOptions,
} from "./sharePointProvider"
