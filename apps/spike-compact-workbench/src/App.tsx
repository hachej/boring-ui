import { useCallback, useEffect, useRef, useState } from "react"
import { DockviewReact, type DockviewApi, type IDockviewPanelProps, type DockviewReadyEvent } from "dockview-react"
import { ITEMS, SURFACES, itemById, itemsFor, type Item, type SurfaceId } from "./data"

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function Body({ item }: { item: Item }) {
  const mono = item.language === "ts" || item.kind === "hit"
  return (
    <pre
      className={
        "m-0 whitespace-pre-wrap break-words px-3 py-2.5 text-[11.5px] leading-[1.55] text-zinc-300 " +
        (mono ? "font-mono" : "font-sans")
      }
    >
      {item.body || "(empty)"}
    </pre>
  )
}

function DetailHeader({
  item,
  onPin,
  onClose,
  inDock,
}: {
  item: Item
  onPin?: () => void
  onClose?: () => void
  inDock?: boolean
}) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-900/60 px-2.5">
      <span className="truncate text-[11.5px] font-medium text-zinc-200">{item.label}</span>
      <span className="rounded border border-zinc-700/70 px-1 text-[9px] uppercase tracking-wide text-zinc-500">
        {inDock ? "read/write" : "read-only peek"}
      </span>
      <div className="ml-auto flex items-center gap-1">
        {onPin ? (
          <button
            onClick={onPin}
            title="Expand / pin into a dock tab"
            className="rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            ⤢ pin
          </button>
        ) : null}
        {onClose ? (
          <button
            onClick={onClose}
            title="Close peek"
            className="rounded px-1.5 py-0.5 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
          >
            ✕
          </button>
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Dock panel                                                          */
/* ------------------------------------------------------------------ */

function DetailPanel(props: IDockviewPanelProps<{ itemId: string }>) {
  const item = itemById(props.params.itemId)
  if (!item) return <div className="p-3 text-xs text-zinc-500">missing</div>
  return (
    <div className="flex h-full flex-col bg-[#0e1116]">
      <DetailHeader item={item} inDock />
      <div className="min-h-0 flex-1 overflow-auto">
        <Body item={item} />
      </div>
    </div>
  )
}

function WelcomePanel() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#0e1116] px-8 text-center">
      <div className="text-sm font-medium text-zinc-300">Dock — where you work on it</div>
      <p className="max-w-md text-[12px] leading-relaxed text-zinc-500">
        Pick something in the column on the left to peek at it. Hit <span className="text-zinc-300">⤢ pin</span> to
        escalate the peek into a real tab here. Tabs opened from the column start ephemeral (italic) and get replaced by
        the next peek until you pin them.
      </p>
    </div>
  )
}

const DOCK_COMPONENTS = { detail: DetailPanel, welcome: WelcomePanel }

/* ------------------------------------------------------------------ */
/* Rail                                                                */
/* ------------------------------------------------------------------ */

function Rail({
  active,
  columnOpen,
  pulses,
  onPick,
}: {
  active: SurfaceId
  columnOpen: boolean
  pulses: Record<string, number>
  onPick: (id: SurfaceId) => void
}) {
  return (
    <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-zinc-800 bg-[#090b0e] py-2">
      {SURFACES.map((s) => {
        const isActive = s.id === active && columnOpen
        const pulsing = (pulses[s.id] ?? 0) > 0
        return (
          <button
            key={s.id}
            onClick={() => onPick(s.id)}
            title={`${s.title} — ${s.hint}`}
            className={
              "relative flex h-8 w-8 items-center justify-center rounded-md text-[15px] transition-colors " +
              (isActive
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200") +
              (pulsing ? " spike-pulse" : "")
            }
          >
            {s.glyph}
            {isActive ? (
              <span className="absolute -left-2 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded bg-blue-400" />
            ) : null}
            {pulsing ? (
              <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-blue-400" />
            ) : null}
          </button>
        )
      })}
      <div className="mt-auto text-[9px] text-zinc-700">A</div>
    </nav>
  )
}

/* ------------------------------------------------------------------ */
/* Column                                                              */
/* ------------------------------------------------------------------ */

function ListRow({
  item,
  selected,
  onSelect,
  onExpand,
}: {
  item: Item
  selected: boolean
  onSelect: () => void
  onExpand: () => void
}) {
  const isDir = item.kind === "dir"
  return (
    <div
      onClick={isDir ? undefined : onSelect}
      onDoubleClick={isDir ? undefined : onExpand}
      style={{ paddingLeft: 8 + (item.depth ?? 0) * 12 }}
      className={
        "group flex cursor-default items-center gap-2 py-[3px] pr-2 text-[12px] " +
        (isDir
          ? "text-zinc-500"
          : selected
            ? "bg-zinc-800/80 text-zinc-100"
            : "text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200")
      }
    >
      <span className="w-3 shrink-0 text-center text-[9px] text-zinc-600">
        {isDir ? "▾" : item.kind === "file" ? "•" : "›"}
      </span>
      <span className="truncate">{item.label}</span>
      {item.sublabel ? (
        <span className="truncate text-[10.5px] text-zinc-600">{item.sublabel}</span>
      ) : null}
      {item.badge ? (
        <span className="ml-auto shrink-0 rounded border border-zinc-700/70 px-1 text-[9px] uppercase text-zinc-500">
          {item.badge}
        </span>
      ) : null}
    </div>
  )
}

function Column({
  surface,
  selection,
  onSelect,
  onExpand,
  onClearSelection,
  onCollapse,
}: {
  surface: SurfaceId
  selection: Item | null
  onSelect: (item: Item) => void
  onExpand: (item: Item, ephemeral: boolean) => void
  onClearSelection: () => void
  onCollapse: () => void
}) {
  const meta = SURFACES.find((s) => s.id === surface)!
  const items = itemsFor(surface)
  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-r border-zinc-800 bg-[#0b0d10]">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-zinc-800 px-2.5">
        <span className="text-[12px] font-semibold text-zinc-200">{meta.title}</span>
        <span className="rounded bg-zinc-800/70 px-1 text-[9px] uppercase tracking-wide text-zinc-500">demo</span>
        <div className="ml-auto flex items-center gap-1 text-zinc-500">
          <button className="rounded px-1 hover:bg-zinc-800 hover:text-zinc-200" title="Search (demo)">
            ⌕
          </button>
          <button
            className="rounded px-1 hover:bg-zinc-800 hover:text-zinc-200"
            title="Collapse column to rail only"
            onClick={onCollapse}
          >
            ⇤
          </button>
        </div>
      </header>

      {/* context list */}
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {items.map((item) => (
          <ListRow
            key={item.id}
            item={item}
            selected={selection?.id === item.id}
            onSelect={() => onSelect(item)}
            onExpand={() => onExpand(item, true)}
          />
        ))}
      </div>

      {/* stacked detail — same column, below the list */}
      {selection ? (
        <div className="flex h-[42%] shrink-0 flex-col border-t border-zinc-800 bg-[#0e1116]">
          <DetailHeader
            item={selection}
            onPin={() => onExpand(selection, false)}
            onClose={onClearSelection}
          />
          <div className="min-h-0 flex-1 overflow-auto">
            <Body item={selection} />
          </div>
        </div>
      ) : (
        <div className="shrink-0 border-t border-zinc-800 px-3 py-2 text-[10.5px] text-zinc-600">
          Click an item — the read-only peek stacks here. Double-click = preview tab.
        </div>
      )}
    </aside>
  )
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export function App() {
  const [active, setActive] = useState<SurfaceId>("files")
  const [columnOpen, setColumnOpen] = useState(true)
  const [selection, setSelection] = useState<Item | null>(null)
  const [pulses, setPulses] = useState<Record<string, number>>({})
  const [narrow, setNarrow] = useState(false)
  const apiRef = useRef<DockviewApi | null>(null)
  const ephemeralRef = useRef<string | null>(null)

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api
    event.api.addPanel({ id: "welcome", component: "welcome", title: "Start here" })
  }, [])

  const openInDock = useCallback((item: Item, opts: { background?: boolean; ephemeral?: boolean } = {}) => {
    const api = apiRef.current
    if (!api) return
    const id = `p-${item.id}`
    const existing = api.getPanel(id)
    if (existing) {
      if (!opts.background) existing.api.setActive()
      return
    }
    // ephemeral (preview) tabs get replaced by the next escalation
    if (opts.ephemeral && ephemeralRef.current && ephemeralRef.current !== id) {
      apiRef.current?.getPanel(ephemeralRef.current)?.api.close()
    }
    api.addPanel({
      id,
      component: "detail",
      params: { itemId: item.id },
      title: opts.ephemeral ? `~ ${item.label}` : item.label,
      inactive: opts.background === true,
    })
    ephemeralRef.current = opts.ephemeral ? id : null
  }, [])

  const pickSurface = (id: SurfaceId) => {
    if (id === active && columnOpen) {
      setColumnOpen(false)
      return
    }
    setActive(id)
    setColumnOpen(true)
    setSelection(null)
    setPulses((p) => ({ ...p, [id]: 0 }))
  }

  // "agent wants to show you something" — steal:false
  const simulateAgentOpen = () => {
    const candidates = ITEMS.filter((i) => i.surface === "inbox" || i.id === "f-shell" || i.surface === "search")
    const item = candidates[Math.floor(Math.random() * candidates.length)]
    openInDock(item, { background: true, ephemeral: true })
    setPulses((p) => ({ ...p, [item.surface]: (p[item.surface] ?? 0) + 1 }))
  }

  useEffect(() => {
    const el = document.documentElement
    el.style.setProperty("--spike-narrow", narrow ? "1" : "0")
  }, [narrow])

  return (
    <div className="flex h-full flex-col bg-[#0b0d10]">
      {/* spike chrome — not part of the proposal */}
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-zinc-800 px-3 text-[11px] text-zinc-500">
        <span className="font-semibold text-zinc-300">Compact Workbench</span>
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-amber-400">
          spike · variant A · fake data
        </span>
        <span className="hidden text-zinc-600 sm:inline">rail 44px → column 320px → dock flex-1</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={simulateAgentOpen}
            className="rounded border border-blue-500/40 bg-blue-500/10 px-2 py-1 text-[11px] text-blue-300 hover:bg-blue-500/20"
            title="openArtifact(..., { steal: false }) — background tab + rail pulse"
          >
            ⚡ Simulate agent open (steal:false)
          </button>
          <button
            onClick={() => setNarrow((n) => !n)}
            className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800"
            title="Narrow-width check"
          >
            {narrow ? "Wide" : "Narrow 900px"}
          </button>
        </div>
      </div>

      <div
        className="mx-auto flex min-h-0 w-full flex-1 overflow-hidden"
        style={narrow ? { maxWidth: 900, borderInline: "1px dashed #27272a" } : undefined}
      >
        <Rail active={active} columnOpen={columnOpen} pulses={pulses} onPick={pickSurface} />
        {columnOpen ? (
          <Column
            surface={active}
            selection={selection}
            onSelect={setSelection}
            onExpand={(item, ephemeral) => openInDock(item, { ephemeral })}
            onClearSelection={() => setSelection(null)}
            onCollapse={() => setColumnOpen(false)}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <DockviewReact components={DOCK_COMPONENTS} onReady={onReady} className="dockview-theme-abyss h-full" />
        </div>
      </div>
    </div>
  )
}
