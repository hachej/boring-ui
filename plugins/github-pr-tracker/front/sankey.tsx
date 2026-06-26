import React from "react"
import { changeWeight } from "./data"
import { ADD_TEXT, DEL_TEXT, addFill, delFill } from "./status"
import type { DiffFile } from "./types"
import { Button, classes } from "./ui"

interface SankeyNode {
  key: string
  label: string
  fullPath: string
  depth: number
  additions: number
  deletions: number
  files: number
  weight: number
  isOverflow?: boolean
  x: number
  y: number
  h: number
}

interface SankeyLink {
  source: string
  target: string
  additions: number
  deletions: number
  files: number
  weight: number
}

interface SankeyLayout {
  columns: SankeyNode[][]
  nodes: Map<string, SankeyNode>
  links: SankeyLink[]
  width: number
  height: number
  depth: number
  maxDepth: number
  barW: number
  slotW: number
  parentsWithChildren: Set<string>
}

const BAR_W = 9
const ROW_GAP = 10
const TOP_PAD = 18
const MAX_COLUMN_NODES = 12

function nodePathFromKey(key: string): string {
  return key === "root" ? "" : key.replace(/^[uo]\d+:/, "")
}

function linkId(link: SankeyLink): string {
  return `${link.source}->${link.target}`
}

function buildSankeyLayout(files: DiffFile[], requestedDepth: number, collapsed: Record<string, boolean>, containerWidth: number): SankeyLayout {
  const fileFolders = files.map((file) => ({ file, parts: file.path.split("/").filter(Boolean).slice(0, -1) }))
  const maxDepth = Math.max(1, Math.min(20, fileFolders.reduce((max, item) => Math.max(max, item.parts.length), 1)))
  const depth = Math.max(1, Math.min(requestedDepth, maxDepth))

  const parentsWithChildren = new Set<string>()
  for (const item of fileFolders) {
    const parts = item.parts.slice(0, depth)
    let parent = "root"
    for (let i = 0; i < parts.length; i += 1) {
      parentsWithChildren.add(parent)
      parent = `u${i + 1}:${parts.slice(0, i + 1).join("/")}`
    }
  }

  const nodes = new Map<string, SankeyNode>()
  const links = new Map<string, SankeyLink>()
  const ensure = (key: string, label: string, nodeDepth: number, additions: number, deletions: number) => {
    const existing = nodes.get(key) ?? {
      key, label, fullPath: nodePathFromKey(key), depth: nodeDepth,
      additions: 0, deletions: 0, files: 0, weight: 0, x: 0, y: 0, h: 0,
    }
    existing.additions += additions
    existing.deletions += deletions
    existing.files += 1
    existing.weight = changeWeight(existing)
    nodes.set(key, existing)
    return existing
  }
  const addLink = (source: string, target: string, additions: number, deletions: number) => {
    const key = `${source}->${target}`
    const existing = links.get(key) ?? { source, target, additions: 0, deletions: 0, files: 0, weight: 0 }
    existing.additions += additions
    existing.deletions += deletions
    existing.files += 1
    existing.weight = changeWeight(existing)
    links.set(key, existing)
  }

  for (const item of fileFolders) {
    const additions = Number(item.file.additions ?? 0)
    const deletions = Number(item.file.deletions ?? 0)
    ensure("root", "root", 0, additions, deletions)
    if (collapsed.root) continue
    let parent = "root"
    const parts = item.parts.slice(0, depth)
    for (let i = 0; i < parts.length; i += 1) {
      const segmentKey = `u${i + 1}:${parts.slice(0, i + 1).join("/")}`
      ensure(segmentKey, parts[i], i + 1, additions, deletions)
      addLink(parent, segmentKey, additions, deletions)
      parent = segmentKey
      if (collapsed[segmentKey]) break
    }
  }

  // Cap column size by folding the long tail into one honest "N more" node
  // per column instead of silently dropping folders.
  const redirect = new Map<string, string>()
  for (let nodeDepth = 1; nodeDepth <= depth; nodeDepth += 1) {
    const column = Array.from(nodes.values()).filter((node) => node.depth === nodeDepth).sort((a, b) => b.weight - a.weight)
    if (column.length <= MAX_COLUMN_NODES) continue
    const overflowKey = `o${nodeDepth}:…`
    const folded = column.slice(MAX_COLUMN_NODES - 1)
    const overflow: SankeyNode = {
      key: overflowKey, label: `${folded.length} more`, fullPath: "", depth: nodeDepth,
      additions: 0, deletions: 0, files: 0, weight: 0, isOverflow: true, x: 0, y: 0, h: 0,
    }
    for (const node of folded) {
      overflow.additions += node.additions
      overflow.deletions += node.deletions
      overflow.files += node.files
      redirect.set(node.key, overflowKey)
      nodes.delete(node.key)
    }
    overflow.weight = changeWeight(overflow)
    nodes.set(overflowKey, overflow)
  }
  if (redirect.size > 0) {
    const merged = new Map<string, SankeyLink>()
    for (const link of links.values()) {
      const source = redirect.get(link.source) ?? link.source
      const target = redirect.get(link.target) ?? link.target
      if (!nodes.has(source) || !nodes.has(target)) continue
      const key = `${source}->${target}`
      const existing = merged.get(key) ?? { source, target, additions: 0, deletions: 0, files: 0, weight: 0 }
      existing.additions += link.additions
      existing.deletions += link.deletions
      existing.files += link.files
      existing.weight = changeWeight(existing)
      merged.set(key, existing)
    }
    links.clear()
    for (const [key, value] of merged) links.set(key, value)
  }

  const incoming = new Map<string, SankeyLink[]>()
  for (const link of links.values()) {
    const list = incoming.get(link.target) ?? []
    list.push(link)
    incoming.set(link.target, list)
  }

  // Order each column by the mean position of its parents (barycenter) so
  // ribbons stay mostly horizontal and rarely cross.
  const order = new Map<string, number>()
  const columns = Array.from({ length: depth + 1 }, (_, nodeDepth) => {
    const column = Array.from(nodes.values()).filter((node) => node.depth === nodeDepth)
    if (nodeDepth === 0) {
      column.forEach((node, index) => order.set(node.key, index))
      return column
    }
    column.sort((a, b) => {
      const barycenter = (key: string) => {
        const list = incoming.get(key) ?? []
        if (list.length === 0) return Number.POSITIVE_INFINITY
        return list.reduce((sum, link) => sum + (order.get(link.source) ?? 999), 0) / list.length
      }
      const delta = barycenter(a.key) - barycenter(b.key)
      if (Math.abs(delta) > 0.001) return delta
      return b.weight - a.weight || a.label.localeCompare(b.label)
    })
    column.forEach((node, index) => order.set(node.key, index))
    return column
  }).filter((column) => column.length > 0)

  const width = Math.max(420, containerWidth)
  const slotW = (width - 16) / Math.max(1, columns.length)
  const maxRows = Math.max(...columns.map((column) => column.length), 1)
  let height = Math.max(280, TOP_PAD * 2 + maxRows * 30)
  let requiredHeight = height
  columns.forEach((column, columnIndex) => {
    const columnWeight = Math.max(1, column.reduce((sum, node) => sum + node.weight, 0))
    const available = height - TOP_PAD * 2 - Math.max(0, column.length - 1) * ROW_GAP
    let y = TOP_PAD
    for (const node of column) {
      node.x = 8 + columnIndex * slotW
      node.h = Math.max(18, (node.weight / columnWeight) * available)
      node.y = y
      y += node.h + ROW_GAP
    }
    requiredHeight = Math.max(requiredHeight, y - ROW_GAP + TOP_PAD)
  })
  height = Math.ceil(requiredHeight)

  const visible = new Set(nodes.keys())
  const visibleLinks = Array.from(links.values())
    .filter((link) => visible.has(link.source) && visible.has(link.target))
    .sort((a, b) => b.weight - a.weight)
  return { columns, nodes, links: visibleLinks, width, height, depth, maxDepth, barW: BAR_W, slotW, parentsWithChildren }
}

function connectedSelection(hoverKey: string, links: SankeyLink[]) {
  const bySource = new Map<string, SankeyLink[]>()
  const byTarget = new Map<string, SankeyLink[]>()
  for (const link of links) {
    bySource.set(link.source, [...(bySource.get(link.source) ?? []), link])
    byTarget.set(link.target, [...(byTarget.get(link.target) ?? []), link])
  }
  const nodes = new Set([hoverKey])
  const linkIds = new Set<string>()
  const down = [hoverKey]
  while (down.length > 0) {
    const key = down.pop()!
    for (const link of bySource.get(key) ?? []) {
      linkIds.add(linkId(link))
      if (!nodes.has(link.target)) { nodes.add(link.target); down.push(link.target) }
    }
  }
  const up = [hoverKey]
  while (up.length > 0) {
    const key = up.pop()!
    for (const link of byTarget.get(key) ?? []) {
      linkIds.add(linkId(link))
      if (!nodes.has(link.source)) { nodes.add(link.source); up.push(link.source) }
    }
  }
  return { nodes, linkIds }
}

interface TooltipState {
  x: number
  y: number
  title: string
  additions: number
  deletions: number
  files: number
  hint?: string
}

export interface DiffSankeyProps {
  files: DiffFile[]
  /** Currently selected file path (highlights its folder chain). */
  selectedFilePath?: string
  /** Current folder scope ("" = everything). */
  scope: string
  onSelectFolder: (path: string) => void
}

export function DiffSankey({ files, selectedFilePath, scope, onSelectFolder }: DiffSankeyProps) {
  const [depthSetting, setDepthSetting] = React.useState(4)
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})
  const [hover, setHover] = React.useState<{ kind: "node" | "link"; key: string } | null>(null)
  const [tooltip, setTooltip] = React.useState<TooltipState | null>(null)
  const [containerWidth, setContainerWidth] = React.useState(720)
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (width > 200) setContainerWidth(Math.floor(width))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const collapsedKeys = Object.keys(collapsed).filter((key) => collapsed[key])
  const layout = React.useMemo(
    () => buildSankeyLayout(files, depthSetting, collapsed, containerWidth - 8),
    [files, depthSetting, collapsedKeys.join("|"), containerWidth],
  )

  const highlighted = React.useMemo(() => {
    if (!hover) return null
    if (hover.kind === "link") {
      const link = layout.links.find((candidate) => linkId(candidate) === hover.key)
      if (!link) return null
      return { nodes: new Set([link.source, link.target]), linkIds: new Set([hover.key]) }
    }
    return connectedSelection(hover.key, layout.links)
  }, [hover, layout])

  const moveTooltip = (event: React.MouseEvent, data: Omit<TooltipState, "x" | "y">) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setTooltip({ ...data, x: Math.min(event.clientX - rect.left + 14, rect.width - 180), y: event.clientY - rect.top + 14 })
  }

  const clearHover = () => { setHover(null); setTooltip(null) }
  const toggleCollapse = (key: string) => setCollapsed((current) => ({ ...current, [key]: !current[key] }))

  // Geometry shared by ribbons and node bodies.
  const barGeometry = (node: SankeyNode) => {
    const weight = changeWeight(node)
    const greenH = Math.max(node.additions > 0 ? 2 : 0, (node.additions / weight) * node.h)
    const redH = Math.max(node.deletions > 0 ? 2 : 0, (node.deletions / weight) * node.h)
    return { greenH, redH, greenY: node.y, redY: node.y + greenH }
  }
  const addOut = new Map<string, number>()
  const addIn = new Map<string, number>()
  const delOut = new Map<string, number>()
  const delIn = new Map<string, number>()

  // Ring only the deepest visible folder of the selected file's chain — a
  // ring on every ancestor reads as noise.
  const selectedKey = React.useMemo(() => {
    const target = selectedFilePath ?? scope
    if (!target) return undefined
    const parts = target.split("/").filter(Boolean)
    const isFile = target === selectedFilePath
    const folderParts = isFile ? parts.slice(0, -1) : parts
    for (let i = folderParts.length; i >= 1; i -= 1) {
      const key = `u${i}:${folderParts.slice(0, i).join("/")}`
      if (layout.nodes.has(key)) return key
    }
    return "root"
  }, [selectedFilePath, scope, layout])

  const flatNodes = layout.columns.flat()
  const labelMaxChars = Math.max(6, Math.floor((layout.slotW - layout.barW - 22) / 6.2))

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Where the change landed — hover a folder to trace its path, click to focus the file list.
        </p>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-[11px] tabular-nums text-muted-foreground">depth {layout.depth}/{layout.maxDepth}</span>
          <Button variant="outline" size="icon-xs" aria-label="Shallower" disabled={layout.depth <= 1}
            onClick={() => setDepthSetting(Math.max(1, layout.depth - 1))}>−</Button>
          <Button variant="outline" size="icon-xs" aria-label="Deeper" disabled={layout.depth >= layout.maxDepth}
            onClick={() => setDepthSetting(Math.min(layout.maxDepth, layout.depth + 1))}>+</Button>
          {collapsedKeys.length > 0 && (
            <Button variant="ghost" size="xs" onClick={() => setCollapsed({})}>
              Unfold {collapsedKeys.length}
            </Button>
          )}
        </div>
      </div>

      <div ref={containerRef} className="relative min-w-0" onMouseLeave={clearHover}>
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ width: "100%", height: layout.height }} role="img" aria-label="Diff folder flow">
          {layout.links.flatMap((link) => {
            const source = layout.nodes.get(link.source)!
            const target = layout.nodes.get(link.target)!
            const sourceGeometry = barGeometry(source)
            const targetGeometry = barGeometry(target)
            const x1 = source.x + layout.barW
            const x2 = target.x
            const mid = (x1 + x2) / 2
            const id = linkId(link)
            const isDimmed = highlighted !== null && !highlighted.linkIds.has(id)
            const isHot = highlighted !== null && highlighted.linkIds.has(id)
            const ribbon = (keySuffix: string, y1Top: number, y1H: number, y2Top: number, y2H: number, fill: string) => (
              <path
                key={`${id}-${keySuffix}`}
                d={`M ${x1} ${y1Top} C ${mid} ${y1Top}, ${mid} ${y2Top}, ${x2} ${y2Top} L ${x2} ${y2Top + y2H} C ${mid} ${y2Top + y2H}, ${mid} ${y1Top + y1H}, ${x1} ${y1Top + y1H} Z`}
                fill={fill}
                className="transition-opacity duration-150 ease-out"
                style={{ opacity: isDimmed ? 0.18 : 1, cursor: "pointer" }}
                onMouseEnter={() => setHover({ kind: "link", key: id })}
                onMouseMove={(event) => moveTooltip(event, {
                  title: `${source.label} → ${target.label}`,
                  additions: link.additions, deletions: link.deletions, files: link.files,
                })}
                onMouseLeave={clearHover}
              />
            )
            const paths: React.ReactNode[] = []
            if (link.additions > 0 && source.additions > 0 && target.additions > 0) {
              const y1H = sourceGeometry.greenH * (link.additions / source.additions)
              const y2H = targetGeometry.greenH * (link.additions / target.additions)
              const y1Top = sourceGeometry.greenY + (addOut.get(source.key) ?? 0)
              const y2Top = targetGeometry.greenY + (addIn.get(target.key) ?? 0)
              addOut.set(source.key, (addOut.get(source.key) ?? 0) + y1H)
              addIn.set(target.key, (addIn.get(target.key) ?? 0) + y2H)
              paths.push(ribbon("add", y1Top, y1H, y2Top, y2H, addFill(isHot ? 0.55 : 0.3)))
            }
            if (link.deletions > 0 && source.deletions > 0 && target.deletions > 0) {
              const y1H = sourceGeometry.redH * (link.deletions / source.deletions)
              const y2H = targetGeometry.redH * (link.deletions / target.deletions)
              const y1Top = sourceGeometry.redY + (delOut.get(source.key) ?? 0)
              const y2Top = targetGeometry.redY + (delIn.get(target.key) ?? 0)
              delOut.set(source.key, (delOut.get(source.key) ?? 0) + y1H)
              delIn.set(target.key, (delIn.get(target.key) ?? 0) + y2H)
              paths.push(ribbon("del", y1Top, y1H, y2Top, y2H, delFill(isHot ? 0.5 : 0.26)))
            }
            return paths
          })}

          {flatNodes.map((node) => {
            const geometry = barGeometry(node)
            const isDimmed = highlighted !== null && !highlighted.nodes.has(node.key)
            const isSelected = node.key === selectedKey
            const canCollapse = layout.parentsWithChildren.has(node.key)
            const isCollapsed = Boolean(collapsed[node.key])
            const name = node.label.length > labelMaxChars ? `${node.label.slice(0, labelMaxChars - 1)}…` : node.label
            const twoLine = node.h >= 30
            const labelX = node.x + layout.barW + 6
            const centerY = node.y + node.h / 2
            return (
              <g
                key={node.key}
                className="transition-opacity duration-150 ease-out"
                style={{ opacity: isDimmed ? 0.25 : 1, cursor: node.isOverflow ? "default" : "pointer", outline: "none" }}
                onMouseEnter={() => setHover({ kind: "node", key: node.key })}
                onMouseMove={(event) => moveTooltip(event, {
                  title: node.key === "root" ? "everything" : node.isOverflow ? `${node.label} (folded)` : node.fullPath,
                  additions: node.additions, deletions: node.deletions, files: node.files,
                  hint: node.isOverflow ? undefined : `click to focus${canCollapse ? " · ⌥click to fold" : ""}`,
                })}
                onMouseLeave={clearHover}
                onClick={(event) => {
                  if (node.isOverflow) return
                  if (event.altKey && canCollapse) { toggleCollapse(node.key); return }
                  onSelectFolder(node.fullPath)
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!node.isOverflow) onSelectFolder(node.fullPath) } }}
              >
                <rect x={node.x} y={node.y} width={layout.barW} height={geometry.greenH} fill={addFill(0.85)} rx={1.5} />
                <rect x={node.x} y={geometry.redY} width={layout.barW} height={geometry.redH} fill={delFill(0.8)} rx={1.5} />
                {isSelected && (
                  <rect x={node.x - 2} y={node.y - 2} width={layout.barW + 4} height={node.h + 4} fill="none" rx={3}
                    stroke="var(--boring-ring, currentColor)" strokeWidth={1.5} />
                )}
                {isCollapsed && (
                  <rect x={node.x} y={node.y} width={layout.barW} height={node.h} fill="none" rx={1.5}
                    stroke="currentColor" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="3 2" />
                )}
                {twoLine ? (
                  <>
                    <text x={labelX} y={centerY - 2} fontSize={11.5} fontWeight={isSelected ? 650 : 500} fill="currentColor">
                      {canCollapse ? (isCollapsed ? "▸ " : "") : ""}{name}
                    </text>
                    <text x={labelX} y={centerY + 11} fontSize={10} fill="currentColor" opacity={0.55}>
                      +{node.additions} −{node.deletions} · {node.files}f
                    </text>
                  </>
                ) : (
                  <text x={labelX} y={centerY + 4} fontSize={11} fontWeight={isSelected ? 650 : 450} fill="currentColor">
                    {canCollapse && isCollapsed ? "▸ " : ""}{name}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {tooltip && (
          <div
            className="pointer-events-none absolute z-20 max-w-64 rounded-md border border-border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            <div className="break-all font-mono text-[11px] leading-4">{tooltip.title}</div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] tabular-nums">
              <span className={classes("font-medium", ADD_TEXT)}>+{tooltip.additions}</span>
              <span className={classes("font-medium", DEL_TEXT)}>−{tooltip.deletions}</span>
              <span className="text-muted-foreground">{tooltip.files} file{tooltip.files === 1 ? "" : "s"}</span>
            </div>
            {tooltip.hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{tooltip.hint}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
