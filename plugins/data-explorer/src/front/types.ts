// ---------------------------------------------------------------------------
// DataExplorer — shared types
//
// The canonical contracts live in shared/types/explorer so plugin/front/server
// code can agree on row, facet, adapter, and drag payload shapes without
// importing the DataExplorer React component tree. This front file re-exports the plugin shared contracts for convenience.
// ---------------------------------------------------------------------------

export type {
  Badge,
  DragPayload,
  ExplorerDataSource,
  ExplorerItem,
  FacetConfig,
  FacetValue,
  Facets,
  FacetsArgs,
  SearchArgs,
  SearchResult,
} from "../shared"
