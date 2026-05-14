// ---------------------------------------------------------------------------
// DataExplorer — shared types
//
// The canonical contracts live in shared/types/explorer so plugin/front/server
// code can agree on row, facet, adapter, and drag payload shapes without
// importing the DataExplorer React component tree. This file preserves the
// historic DataExplorer import path for front consumers.
// ---------------------------------------------------------------------------

export type {
  Badge,
  DragPayload,
  ExplorerAdapter,
  ExplorerRow,
  FacetConfig,
  FacetValue,
  Facets,
  FacetsArgs,
  SearchArgs,
  SearchResult,
} from "../../../shared/types/explorer"
