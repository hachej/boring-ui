import type { CatalogRow } from "../../../shared/plugins/types"

/**
 * Discriminated union for Recent entries in CommandPalette.
 *
 * **Serialization invariant:** `rowSnapshot` is round-tripped through
 * `JSON.stringify` / `JSON.parse` via localStorage. Any `CatalogRow`
 * participating in Recent MUST be 100% JSON-serializable. Adapters with
 * non-serializable values (Date, Map, Set, functions, React nodes, class
 * instances) must serialize at row construction time and re-hydrate in
 * their renderer.
 */
export type RecentEntry =
  | {
      type: "catalog"
      catalogId: string
      rowId: string
      rowSnapshot: CatalogRow
      selectedAt: number
    }
  | {
      type: "command"
      commandId: string
      titleSnapshot: string
      selectedAt: number
    }
