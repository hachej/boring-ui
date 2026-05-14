import { useCallback, useEffect, useReducer, useRef } from "react"
import type {
  ExplorerAdapter,
  ExplorerRow,
  FacetConfig,
  Facets,
  SearchArgs,
} from "./types"

export type UseExplorerStateOptions = {
  adapter: ExplorerAdapter
  /** Facets shown in the toolbar popover. Adapter must implement fetchFacets. */
  facets?: FacetConfig[]
  /** Facet key used as the single grouping axis (tree mode). */
  groupBy?: string
  /** Page size for both top-level and per-group pagination. */
  pageSize?: number
  /** Debounce window (ms) applied to setQuery. */
  debounceMs?: number
  /**
   * Controlled query. When set, the hook bypasses internal debounce and
   * `setQuery` becomes a no-op — the caller owns the value (and any debounce
   * the caller wants to apply). Searches re-run when this prop changes.
   */
  query?: string
}

type GroupState = {
  items: ExplorerRow[]
  total: number
  hasMore: boolean
  loading: boolean
}

type State = {
  query: string
  pendingQuery: string
  filters: Record<string, string[]>
  topItems: ExplorerRow[]
  topTotal: number
  topHasMore: boolean
  topOffset: number
  expanded: Record<string, boolean>
  groups: Record<string, GroupState>
  facets: Facets | null
  loading: boolean
}

const EMPTY_GROUP: GroupState = { items: [], total: 0, hasMore: false, loading: false }

type Action =
  | { type: "setPendingQuery"; query: string }
  | { type: "applyQuery"; query: string }
  | { type: "setFilters"; filters: Record<string, string[]> }
  | { type: "expandGroup"; value: string }
  | { type: "collapseGroup"; value: string }
  | { type: "topResolved"; items: ExplorerRow[]; total: number; hasMore: boolean; offset: number; append: boolean }
  | { type: "groupResolved"; value: string; items: ExplorerRow[]; total: number; hasMore: boolean; append: boolean }
  | { type: "groupLoading"; value: string; loading: boolean }
  | { type: "facetsResolved"; facets: Facets }
  | { type: "loading"; loading: boolean }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "setPendingQuery":
      return { ...state, pendingQuery: action.query }
    case "applyQuery":
      return {
        ...state,
        query: action.query,
        pendingQuery: action.query,
        topItems: [],
        topTotal: 0,
        topHasMore: false,
        topOffset: 0,
        expanded: {},
        groups: {},
      }
    case "setFilters":
      return {
        ...state,
        filters: action.filters,
        topItems: [],
        topTotal: 0,
        topHasMore: false,
        topOffset: 0,
        expanded: {},
        groups: {},
      }
    case "expandGroup":
      return { ...state, expanded: { ...state.expanded, [action.value]: true } }
    case "collapseGroup":
      return { ...state, expanded: { ...state.expanded, [action.value]: false } }
    case "topResolved":
      return {
        ...state,
        topItems: action.append ? [...state.topItems, ...action.items] : action.items,
        topTotal: action.total,
        topHasMore: action.hasMore,
        topOffset: action.offset + action.items.length,
      }
    case "groupResolved": {
      const prev = state.groups[action.value] ?? EMPTY_GROUP
      return {
        ...state,
        groups: {
          ...state.groups,
          [action.value]: {
            items: action.append ? [...prev.items, ...action.items] : action.items,
            total: action.total,
            hasMore: action.hasMore,
            loading: false,
          },
        },
      }
    }
    case "groupLoading": {
      const prev = state.groups[action.value] ?? EMPTY_GROUP
      return {
        ...state,
        groups: { ...state.groups, [action.value]: { ...prev, loading: action.loading } },
      }
    }
    case "facetsResolved":
      return { ...state, facets: action.facets }
    case "loading":
      return { ...state, loading: action.loading }
  }
}

const INITIAL: State = {
  query: "",
  pendingQuery: "",
  filters: {},
  topItems: [],
  topTotal: 0,
  topHasMore: false,
  topOffset: 0,
  expanded: {},
  groups: {},
  facets: null,
  loading: false,
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError"
}

export function useExplorerState(options: UseExplorerStateOptions) {
  const {
    adapter,
    facets: facetConfigs,
    groupBy,
    pageSize = 50,
    debounceMs = 200,
    query: controlledQuery,
  } = options
  const isControlled = controlledQuery !== undefined
  const [state, dispatch] = useReducer(reducer, INITIAL)

  // Refs make all runners stable across renders — no effect-loops.
  const stateRef = useRef(state)
  stateRef.current = state
  const adapterRef = useRef(adapter)
  adapterRef.current = adapter
  const optsRef = useRef({ pageSize, groupBy, hasFacets: !!facetConfigs?.length })
  optsRef.current = { pageSize, groupBy, hasFacets: !!facetConfigs?.length }

  const topController = useRef<AbortController | null>(null)
  const groupControllers = useRef<Map<string, AbortController>>(new Map())
  const facetController = useRef<AbortController | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)

  // -------------------------------------------------------------------------
  const runTopSearch = useCallback(
    async (args: { query: string; filters: Record<string, string[]>; offset: number; append: boolean }) => {
      topController.current?.abort()
      const ctrl = new AbortController()
      topController.current = ctrl
      dispatch({ type: "loading", loading: true })
      const searchArgs: SearchArgs = {
        query: args.query,
        filters: args.filters,
        offset: args.offset,
        limit: optsRef.current.pageSize,
        signal: ctrl.signal,
      }
      try {
        const result = await adapterRef.current.search(searchArgs)
        if (!mounted.current || ctrl.signal.aborted) return
        dispatch({
          type: "topResolved",
          items: result.items,
          total: result.total,
          hasMore: result.hasMore,
          offset: args.offset,
          append: args.append,
        })
      } catch (err) {
        if (isAbortError(err)) return
        // eslint-disable-next-line no-console
        console.error("DataExplorer: search failed", err)
      } finally {
        if (mounted.current && topController.current === ctrl) {
          dispatch({ type: "loading", loading: false })
        }
      }
    },
    [],
  )

  const runGroupSearch = useCallback(
    async (args: { groupValue: string; query: string; filters: Record<string, string[]>; offset: number; append: boolean }) => {
      const groupKey = optsRef.current.groupBy
      if (!groupKey) return
      groupControllers.current.get(args.groupValue)?.abort()
      const ctrl = new AbortController()
      groupControllers.current.set(args.groupValue, ctrl)
      dispatch({ type: "groupLoading", value: args.groupValue, loading: true })
      const searchArgs: SearchArgs = {
        query: args.query,
        filters: args.filters,
        group: { key: groupKey, value: args.groupValue },
        offset: args.offset,
        limit: optsRef.current.pageSize,
        signal: ctrl.signal,
      }
      try {
        const result = await adapterRef.current.search(searchArgs)
        if (!mounted.current || ctrl.signal.aborted) return
        dispatch({
          type: "groupResolved",
          value: args.groupValue,
          items: result.items,
          total: result.total,
          hasMore: result.hasMore,
          append: args.append,
        })
      } catch (err) {
        if (isAbortError(err)) return
        // eslint-disable-next-line no-console
        console.error("DataExplorer: group search failed", err)
        if (mounted.current) {
          dispatch({ type: "groupLoading", value: args.groupValue, loading: false })
        }
      }
    },
    [],
  )

  const runFetchFacets = useCallback(async (filters: Record<string, string[]>) => {
    if (!optsRef.current.hasFacets) return
    const fetchFacets = adapterRef.current.fetchFacets
    if (!fetchFacets) return
    facetController.current?.abort()
    const ctrl = new AbortController()
    facetController.current = ctrl
    try {
      const facets = await fetchFacets({ filters, signal: ctrl.signal })
      if (!mounted.current || ctrl.signal.aborted) return
      dispatch({ type: "facetsResolved", facets })
    } catch (err) {
      if (isAbortError(err)) return
      // eslint-disable-next-line no-console
      console.error("DataExplorer: fetchFacets failed", err)
    }
  }, [])

  // -------------------------------------------------------------------------
  // Trigger top + facets when scope (query/filters) changes. Imperative —
  // called from action handlers, not via state-watching effect, to keep the
  // dependency graph trivially stable.
  const refreshScope = useCallback(
    (query: string, filters: Record<string, string[]>) => {
      void runTopSearch({ query, filters, offset: 0, append: false })
      void runFetchFacets(filters)
    },
    [runTopSearch, runFetchFacets],
  )

  // -------------------------------------------------------------------------
  const isControlledRef = useRef(isControlled)
  isControlledRef.current = isControlled

  const setQuery = useCallback(
    (q: string) => {
      // Controlled mode: caller owns the value; setQuery is intentionally a
      // no-op so the explorer's internal toolbar (when shown) doesn't fight
      // the controlled prop.
      if (isControlledRef.current) return
      dispatch({ type: "setPendingQuery", query: q })
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => {
        dispatch({ type: "applyQuery", query: q })
        refreshScope(q, stateRef.current.filters)
      }, debounceMs)
    },
    [debounceMs, refreshScope],
  )

  const toggleFilter = useCallback(
    (key: string, value: string) => {
      const current = stateRef.current.filters[key] ?? []
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
      const nextFilters = { ...stateRef.current.filters }
      if (next.length) nextFilters[key] = next
      else delete nextFilters[key]
      dispatch({ type: "setFilters", filters: nextFilters })
      refreshScope(stateRef.current.query, nextFilters)
    },
    [refreshScope],
  )

  const clearFilters = useCallback(() => {
    dispatch({ type: "setFilters", filters: {} })
    refreshScope(stateRef.current.query, {})
  }, [refreshScope])

  const expandGroup = useCallback(
    (value: string) => {
      const isLoaded = (stateRef.current.groups[value]?.items.length ?? 0) > 0
      dispatch({ type: "expandGroup", value })
      if (!isLoaded) {
        void runGroupSearch({
          groupValue: value,
          query: stateRef.current.query,
          filters: stateRef.current.filters,
          offset: 0,
          append: false,
        })
      }
    },
    [runGroupSearch],
  )

  const collapseGroup = useCallback((value: string) => {
    dispatch({ type: "collapseGroup", value })
  }, [])

  const loadMoreTop = useCallback(() => {
    const s = stateRef.current
    if (!s.topHasMore) return
    void runTopSearch({
      query: s.query,
      filters: s.filters,
      offset: s.topOffset,
      append: true,
    })
  }, [runTopSearch])

  const loadMoreGroup = useCallback(
    (value: string) => {
      const s = stateRef.current
      const g = s.groups[value]
      if (!g?.hasMore) return
      void runGroupSearch({
        groupValue: value,
        query: s.query,
        filters: s.filters,
        offset: g.items.length,
        append: true,
      })
    },
    [runGroupSearch],
  )

  // -------------------------------------------------------------------------
  // Mount: run initial search + facets. Cleanup: abort everything.
  useEffect(() => {
    mounted.current = true
    const initialQuery = isControlledRef.current ? (controlledQuery ?? "") : ""
    if (initialQuery) {
      dispatch({ type: "applyQuery", query: initialQuery })
    }
    refreshScope(initialQuery, {})
    return () => {
      mounted.current = false
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      topController.current?.abort()
      facetController.current?.abort()
      for (const ctrl of groupControllers.current.values()) ctrl.abort()
      groupControllers.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -------------------------------------------------------------------------
  // Controlled query: re-run search whenever the prop changes (after mount).
  const lastControlledQuery = useRef<string | undefined>(controlledQuery)
  useEffect(() => {
    if (!isControlled) return
    if (lastControlledQuery.current === controlledQuery) return
    lastControlledQuery.current = controlledQuery
    const next = controlledQuery ?? ""
    dispatch({ type: "applyQuery", query: next })
    refreshScope(next, stateRef.current.filters)
  }, [isControlled, controlledQuery, refreshScope])

  // -------------------------------------------------------------------------
  const getGroup = useCallback(
    (value: string): GroupState => state.groups[value] ?? EMPTY_GROUP,
    [state.groups],
  )
  const isExpanded = useCallback(
    (value: string): boolean => !!state.expanded[value],
    [state.expanded],
  )

  return {
    query: state.pendingQuery,
    filters: state.filters,
    facets: state.facets,
    topItems: state.topItems,
    topTotal: state.topTotal,
    topHasMore: state.topHasMore,
    loading: state.loading,
    getGroup,
    isExpanded,
    setQuery,
    toggleFilter,
    clearFilters,
    expandGroup,
    collapseGroup,
    loadMoreTop,
    loadMoreGroup,
  }
}

export type UseExplorerStateReturn = ReturnType<typeof useExplorerState>
