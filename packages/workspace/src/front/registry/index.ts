export { PanelRegistry } from "./PanelRegistry"
// `CommandRegistry` + `SurfaceResolverRegistry` are layer-agnostic (no
// React/browser APIs) and live under `shared/plugins/`. Re-exported here
// for backwards-compatible import paths.
export { CommandRegistry } from "../../shared/plugins/CommandRegistry"
export { SurfaceResolverRegistry } from "../../shared/plugins/SurfaceResolverRegistry"
export {
  RegistryProvider,
  useRegistry,
  useCommandRegistry,
  useCatalogRegistry,
  useSurfaceResolverRegistry,
} from "./RegistryProvider"
export { getFileIcon } from "./getFileIcon"
export type { PanelConfig, PanelRegistration, CommandConfig, PaneProps } from "./types"
export type {
  SurfaceOpenRequest,
  SurfacePanelResolution,
  SurfaceResolverConfig,
  SurfaceResolverRegistration,
} from "../../shared/types/surface"
export { WORKSPACE_OPEN_PATH_SURFACE_KIND } from "../../shared/types/surface"
