export { PanelRegistry } from "./PanelRegistry"
export { CommandRegistry } from "./CommandRegistry"
export { SurfaceResolverRegistry } from "./SurfaceResolverRegistry"
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
