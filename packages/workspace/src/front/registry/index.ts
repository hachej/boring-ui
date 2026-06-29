export { PanelRegistry } from "./PanelRegistry"
export { WorkspaceSourceRegistry } from "./WorkspaceSourceRegistry"
export {
  RegistryProvider,
  useRegistry,
  useWorkspaceSourceRegistry,
  useCommandRegistry,
  useCatalogRegistry,
  useSurfaceResolverRegistry,
} from "./RegistryProvider"
export { getFileIcon } from "./getFileIcon"
export type {
  PanelConfig,
  PanelRegistration,
  CommandConfig,
  PaneProps,
  WorkspaceSourceConfig,
  WorkspaceSourceOpenPanelConfig,
  WorkspaceSourceProps,
  WorkspaceSourceRegistration,
} from "./types"
export type {
  SurfaceOpenRequest,
  SurfacePanelResolution,
  SurfaceResolverConfig,
  SurfaceResolverRegistration,
} from "../../shared/types/surface"
export { WORKSPACE_OPEN_PATH_SURFACE_KIND } from "../../shared/types/surface"
