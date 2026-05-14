import type { ComponentType, ReactNode } from "react"
import type { DataExplorerProps } from "../../../front/components/DataExplorer"
import type {
  DragPayload,
  ExplorerAdapter,
  ExplorerRow,
  FacetConfig,
} from "../../../shared/types/explorer"
import type { WorkspaceBridge } from "../../../front/bridge/types"
import type { PaneProps, PanelConfig } from "../../../front/registry/types"
import type { LeftTabParams } from "../../../shared/plugins/types"

export interface DataCatalogVisualizationParams {
  row?: ExplorerRow
  query?: string
}

export interface OpenDataCatalogVisualizationOptions {
  catalogId: string
  surfaceKind?: string
  title?: string
  params?: Record<string, unknown>
}

export interface DataCatalogSelectContext {
  params?: LeftTabParams
  bridge?: WorkspaceBridge
}

export interface CreateDataCatalogOutputsOptions {
  /**
   * Base contribution id. Defaults catalog id to this value and left tab /
   * visualization panel ids to derived names.
   */
  id?: string
  label?: string
  adapter: ExplorerAdapter
  facets?: FacetConfig[]
  groupBy?: string
  getDragPayload?: (row: ExplorerRow) => DragPayload | null | undefined
  onSelect?: (row: ExplorerRow, context: DataCatalogSelectContext) => void
  emptyState?: ReactNode
  searchPlaceholder?: string
  pageSize?: number
  debounceMs?: number
  leftTabId?: string
  leftTabTitle?: string
  leftTabIcon?: PanelConfig["icon"]
  includeLeftTab?: boolean
  catalogId?: string
  catalogLabel?: string
  includeCatalog?: boolean
  visualizationPanelId?: string
  visualizationTitle?: string
  visualizationIcon?: PanelConfig["icon"]
  visualizationComponent?: ComponentType<PaneProps<DataCatalogVisualizationParams>>
  includeVisualizationPanel?: boolean
  surfaceKind?: string
  surfaceResolverId?: string
  includeSurfaceResolver?: boolean
  source?: PanelConfig["source"]
}

export interface CreateDataCatalogPluginOptions
  extends CreateDataCatalogOutputsOptions {
  pluginId?: string
}

export interface DataCatalogResolvedQuery {
  query?: string
  controlled: boolean
}

export interface DataCatalogVisualizationState extends DataCatalogResolvedQuery {
  row?: ExplorerRow
  title: string
}

export type { DataExplorerProps }
