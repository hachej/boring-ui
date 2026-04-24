"use client"

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, Database, FolderTree, Search, X } from "lucide-react"
import { cn } from "../../lib/utils"
import type { WorkspaceBridge } from "../../bridge/types"
import { useFileList, useDataClient } from "../../data"
import type { FileEntry } from "../../data/types"
import type { FileTreeNode } from "../FileTree"
import { DataCatalog, type DataSource } from "../DataCatalog"

const FileTree = lazy(() =>
  import("../FileTree").then((m) => ({ default: m.FileTree })),
)

export type WorkbenchLeftTab = "files" | "data"

export interface WorkbenchLeftPaneProps {
  rootDir?: string
  bridge?: WorkspaceBridge
  dataSources?: DataSource[]
  defaultTab?: WorkbenchLeftTab
  onCollapse?: () => void
  className?: string
}

function buildTree(
  entries: FileEntry[],
  childrenByDir: Map<string, FileEntry[]>,
): FileTreeNode[] {
  const dirs: FileTreeNode[] = []
  const files: FileTreeNode[] = []
  for (const entry of entries) {
    if (entry.kind === "dir") {
      const children = childrenByDir.get(entry.path)
      dirs.push({
        ...entry,
        children: children ? buildTree(children, childrenByDir) : [],
      })
    } else {
      files.push({ ...entry })
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name))
  files.sort((a, b) => a.name.localeCompare(b.name))
  return [...dirs, ...files]
}

export function WorkbenchLeftPane({
  rootDir = "",
  bridge,
  dataSources = [],
  defaultTab = "files",
  onCollapse,
  className,
}: WorkbenchLeftPaneProps) {
  const [tab, setTab] = useState<WorkbenchLeftTab>(defaultTab)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), 180)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  const dataClient = useDataClient()
  const { data: fileList } = useFileList(rootDir)
  const [expandedChildren, setExpandedChildren] = useState<Map<string, FileEntry[]>>(new Map())

  const handleExpand = useCallback(
    async (dirPath: string) => {
      try {
        const children = await dataClient.getTree(dirPath)
        setExpandedChildren((prev) => new Map(prev).set(dirPath, children))
      } catch {}
    },
    [dataClient],
  )

  const treeData = useMemo(
    () => buildTree(fileList ?? [], expandedChildren),
    [fileList, expandedChildren],
  )

  const handleSelect = useCallback(
    (path: string) => bridge?.openFile(path, { mode: "edit" }),
    [bridge],
  )

  const toggleSearch = useCallback(() => {
    setSearchOpen((s) => {
      if (s) setQuery("")
      return !s
    })
  }, [])

  const onSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault()
      setSearchOpen(false)
      setQuery("")
    }
  }, [])

  return (
    <div className={cn("workbench-left-root flex h-full min-h-0 flex-col", className)}>
      <div className="flex items-center gap-1 border-b border-[color:oklch(from_var(--border)_l_c_h/0.25)] px-2" style={{ height: 44 }}>
        <div
          role="tablist"
          aria-label="Workbench sources"
          className="flex items-center gap-0.5"
        >
          <SegmentedTab
            active={tab === "files"}
            onClick={() => setTab("files")}
            icon={<FolderTree className="h-3.5 w-3.5" />}
          >
            Files
          </SegmentedTab>
          <SegmentedTab
            active={tab === "data"}
            onClick={() => setTab("data")}
            icon={<Database className="h-3.5 w-3.5" />}
          >
            Data
          </SegmentedTab>
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={toggleSearch}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground",
            "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
            "hover:bg-foreground/5 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            searchOpen && "bg-foreground/5 text-foreground",
          )}
          aria-label="Search"
          title="Search"
        >
          <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground",
              "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
              "hover:bg-foreground/5 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
            aria-label="Hide files"
            title="Hide files"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {searchOpen && (
        <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={tab === "files" ? "Search files..." : "Search data..."}
            className="h-6 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "files" ? (
          <Suspense fallback={<LoadingFallback />}>
            <FileTree
              files={treeData}
              searchQuery={debouncedQuery || undefined}
              onSelect={handleSelect}
              onExpand={handleExpand}
              className="px-1 pt-1 [&_[role=treeitem]]:!indent-0"
            />
          </Suspense>
        ) : (
          <FilteredDataCatalog sources={dataSources} query={debouncedQuery} />
        )}
      </div>
    </div>
  )
}

function SegmentedTab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={cn(
        "relative flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium",
        "transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span className={cn("transition-colors", active ? "text-[color:var(--accent)]" : "")}>{icon}</span>
      <span className="tracking-tight">{children}</span>
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-x-1 -bottom-[9px] h-[2px] rounded-t-[2px] bg-[color:var(--accent)]"
        />
      )}
    </button>
  )
}

function FilteredDataCatalog({ sources, query }: { sources: DataSource[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return sources
    const q = query.toLowerCase()
    return sources.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.type.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q),
    )
  }, [sources, query])
  return <DataCatalog sources={filtered} />
}

function LoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <span className="animate-pulse">Loading…</span>
    </div>
  )
}
