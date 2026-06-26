import React from "react"
import { isDocOrTestFile } from "./data"
import { DiffViewer, type DiffLayout } from "./diffViewer"
import { fileOrder, FileTree, type TreeSort } from "./fileTree"
import { DiffSankey } from "./sankey"
import { ADD_TEXT, DEL_TEXT } from "./status"
import type { DiffFile, PullRequest } from "./types"
import { Button, classes, EmptyState, Kbd } from "./ui"

/** Default to the biggest readable change: highest churn, preferring files with a captured patch. */
function pickDefaultFile(files: DiffFile[]): DiffFile | undefined {
  const pool = files.some((file) => file.patch) ? files.filter((file) => file.patch) : files
  return pool.slice().sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))[0]
}

export function DiffExplorer({ pr }: { pr: PullRequest }) {
  const diff = pr.diffSummary
  const [hideDocsTests, setHideDocsTests] = React.useState(false)
  const [showSankey, setShowSankey] = React.useState(true)
  const [sort, setSort] = React.useState<TreeSort>("churn")
  const [diffLayout, setDiffLayout] = React.useState<DiffLayout>("unified")
  const [scope, setScope] = React.useState("")
  const [selectedFilePath, setSelectedFilePath] = React.useState<string | undefined>(undefined)
  const [treeWidth, setTreeWidth] = React.useState(300)
  const sectionRef = React.useRef<HTMLElement>(null)
  const resizeOrigin = React.useRef<{ x: number; width: number } | null>(null)

  const allFiles = React.useMemo(
    () => (diff?.files ?? []).filter((file) => !hideDocsTests || !isDocOrTestFile(file.path)),
    [diff, hideDocsTests],
  )
  const scopedFiles = React.useMemo(
    () => allFiles.filter((file) => !scope || file.path === scope || file.path.startsWith(`${scope}/`)),
    [allFiles, scope],
  )
  // Navigation follows the tree's visual top-to-bottom order.
  const navOrder = React.useMemo(() => fileOrder(scopedFiles, sort), [scopedFiles, sort])
  const selectedFile: DiffFile | undefined =
    scopedFiles.find((file) => file.path === selectedFilePath) ?? pickDefaultFile(scopedFiles)

  // Keep the default selection's folder chain visible.
  React.useEffect(() => {
    if (!selectedFile) return
  }, [selectedFile?.path])

  const selectFile = (path: string) => {
    setSelectedFilePath(path)
  }

  const selectFolder = (folder: string) => {
    setScope(folder)
    const first = pickDefaultFile(
      allFiles.filter((file) => !folder || file.path === folder || file.path.startsWith(`${folder}/`)),
    )
    setSelectedFilePath(first?.path)
  }

  const moveFile = (delta: number) => {
    if (navOrder.length === 0) return
    const currentIndex = navOrder.findIndex((file) => file.path === selectedFile?.path)
    const nextIndex = (currentIndex + delta + navOrder.length) % navOrder.length
    selectFile(navOrder[nextIndex].path)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const tag = (event.target as HTMLElement | null)?.tagName?.toLowerCase()
    if (tag === "input" || tag === "textarea" || tag === "select") return
    if (event.key === "ArrowUp" || event.key === "k") { event.preventDefault(); moveFile(-1) }
    if (event.key === "ArrowDown" || event.key === "j") { event.preventDefault(); moveFile(1) }
  }

  // Buttons don't take focus on click in every browser (notably macOS), so
  // pull focus onto the explorer for any non-form click — otherwise j/k key
  // events never reach handleKeyDown.
  const focusExplorer = (event: React.MouseEvent) => {
    const tag = (event.target as HTMLElement | null)?.tagName?.toLowerCase()
    if (tag === "input" || tag === "textarea" || tag === "select") return
    sectionRef.current?.focus({ preventScroll: true })
  }

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    resizeOrigin.current = { x: event.clientX, width: treeWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const origin = resizeOrigin.current
    if (!origin) return
    setTreeWidth(Math.max(200, Math.min(480, origin.width + event.clientX - origin.x)))
  }
  const endResize = () => { resizeOrigin.current = null }

  if (!diff || (!diff.changedFiles && !diff.additions && !diff.deletions)) {
    return (
      <EmptyState
        title="No diff summary yet"
        description="Ask the agent to refresh the GitHub PR tracker to collect file-level changes."
      />
    )
  }

  const hiddenCount = (diff.files ?? []).length - allFiles.length
  const scopeParts = scope.split("/").filter(Boolean)
  const navIndex = navOrder.findIndex((file) => file.path === selectedFile?.path)

  return (
    <section ref={sectionRef} tabIndex={-1} className="space-y-3 outline-none" onKeyDown={handleKeyDown} onClick={focusExplorer}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
        <h3 className="text-sm font-semibold">
          Changes
          <span className="ml-2 font-normal tabular-nums text-muted-foreground">
            {allFiles.length} file{allFiles.length === 1 ? "" : "s"}
            <span className={classes("ml-2 font-medium", ADD_TEXT)}>+{diff.additions}</span>
            <span className={classes("ml-1.5 font-medium", DEL_TEXT)}>−{diff.deletions}</span>
          </span>
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant={showSankey ? "secondary" : "ghost"} size="xs" onClick={() => setShowSankey(!showSankey)}>
            Flow
          </Button>
          <Button variant={hideDocsTests ? "secondary" : "ghost"} size="xs" onClick={() => setHideDocsTests(!hideDocsTests)}>
            {hideDocsTests ? `Code only · ${hiddenCount} hidden` : "Hide docs & tests"}
          </Button>
          <select
            className="h-6 rounded-md border border-border bg-background px-1.5 text-xs text-foreground"
            value={diffLayout}
            onChange={(event) => setDiffLayout(event.currentTarget.value as DiffLayout)}
            aria-label="Diff layout"
          >
            <option value="unified">Unified</option>
            <option value="split">Split</option>
          </select>
          <select
            className="h-6 rounded-md border border-border bg-background px-1.5 text-xs text-foreground"
            value={sort}
            onChange={(event) => setSort(event.currentTarget.value as TreeSort)}
            aria-label="Sort files"
          >
            <option value="churn">Churn</option>
            <option value="additions">Additions</option>
            <option value="deletions">Deletions</option>
            <option value="alpha">A–Z</option>
          </select>
        </div>
      </div>

      {showSankey && (
        <DiffSankey
          files={allFiles}
          selectedFilePath={selectedFile?.path}
          scope={scope}
          onSelectFolder={selectFolder}
        />
      )}

      {scope && (
        <nav aria-label="Folder scope" className="flex flex-wrap items-center gap-1 text-xs">
          <button type="button" className="text-muted-foreground hover:text-foreground hover:underline" onClick={() => selectFolder("")}>
            all files
          </button>
          {scopeParts.map((part, index) => (
            <React.Fragment key={index}>
              <span className="text-muted-foreground/50">/</span>
              {index === scopeParts.length - 1 ? (
                <span className="font-medium">{part}</span>
              ) : (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground hover:underline"
                  onClick={() => selectFolder(scopeParts.slice(0, index + 1).join("/"))}
                >
                  {part}
                </button>
              )}
            </React.Fragment>
          ))}
          <span className="ml-1 tabular-nums text-muted-foreground">· {scopedFiles.length}/{allFiles.length} files</span>
        </nav>
      )}

      <div className="flex min-h-0 overflow-hidden rounded-lg border border-border" style={{ height: 600, maxHeight: "72vh" }}>
        <div className="flex min-h-0 flex-col" style={{ width: treeWidth, flex: `0 0 ${treeWidth}px` }}>
          <div className="min-h-0 flex-1 overflow-hidden">
            <FileTree
              files={scopedFiles}
              sort={sort}
              selectedFilePath={selectedFile?.path}
              onSelectFile={selectFile}
            />
          </div>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize"
          className="w-1 shrink-0 cursor-col-resize border-x border-border/60 bg-transparent transition-colors hover:bg-ring/30"
          onPointerDown={startResize}
          onPointerMove={onResizeMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
            {selectedFile ? (
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs">
                  {selectedFile.path.includes("/") && (
                    <span className="text-muted-foreground">{selectedFile.path.slice(0, selectedFile.path.lastIndexOf("/") + 1)}</span>
                  )}
                  <span className="font-medium">{selectedFile.path.slice(selectedFile.path.lastIndexOf("/") + 1)}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] tabular-nums">
                  <span className={classes("font-medium", ADD_TEXT)}>+{selectedFile.additions}</span>
                  <span className={classes("font-medium", DEL_TEXT)}>−{selectedFile.deletions}</span>
                  {selectedFile.changeType && selectedFile.changeType !== "modified" && (
                    <span className="text-muted-foreground">{selectedFile.changeType}</span>
                  )}
                </div>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">Select a file to view its diff</span>
            )}
            <div className="flex shrink-0 items-center gap-1">
              <span className="mr-1 hidden items-center gap-1 text-[10px] text-muted-foreground sm:flex">
                <Kbd>j</Kbd><Kbd>k</Kbd>
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground">{navIndex + 1}/{navOrder.length}</span>
              <Button variant="ghost" size="icon-xs" aria-label="Previous file" disabled={navOrder.length < 2} onClick={() => moveFile(-1)}>↑</Button>
              <Button variant="ghost" size="icon-xs" aria-label="Next file" disabled={navOrder.length < 2} onClick={() => moveFile(1)}>↓</Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto" tabIndex={0}>
            {selectedFile ? (
              <DiffViewer file={selectedFile} prUrl={pr.url} layout={diffLayout} />
            ) : (
              <div className="p-6 text-center text-xs text-muted-foreground">Pick a file from the tree.</div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
