// Static demo data for the compact-workbench spike. All fake, labelled "demo".

export type SurfaceId = "files" | "agents" | "tasks" | "automations" | "search" | "inbox"

export type Item = {
  id: string
  surface: SurfaceId
  label: string
  sublabel?: string
  depth?: number
  kind?: "dir" | "file" | "task" | "automation" | "chat" | "hit" | "intent"
  badge?: string
  body: string
  language?: "ts" | "md" | "text"
}

export const SURFACES: { id: SurfaceId; title: string; glyph: string; hint: string }[] = [
  { id: "files", title: "Files", glyph: "▤", hint: "Workspace tree (demo)" },
  { id: "agents", title: "Chat / Agents", glyph: "◧", hint: "Running agent sessions (demo)" },
  { id: "tasks", title: "Tasks", glyph: "◔", hint: "Task queue (demo)" },
  { id: "automations", title: "Automations", glyph: "◇", hint: "Scheduled runs (demo)" },
  { id: "search", title: "Search", glyph: "⌕", hint: "Repo search (demo)" },
  { id: "inbox", title: "Inbox", glyph: "▦", hint: "Human intention items (demo)" },
]

const file = (id: string, label: string, depth: number, body: string, language: Item["language"] = "ts"): Item => ({
  id,
  surface: "files",
  label,
  depth,
  kind: "file",
  body,
  language,
})

export const ITEMS: Item[] = [
  { id: "d-src", surface: "files", label: "src", depth: 0, kind: "dir", body: "" },
  { id: "d-front", surface: "files", label: "front", depth: 1, kind: "dir", body: "" },
  file(
    "f-app",
    "app.ts",
    1,
    `import { createWorkbench } from "./workbench"\nimport { registerSurfaces } from "./surfaces"\n\n// demo file — spike fixture, not real source\nexport const app = createWorkbench({\n  rail: registerSurfaces(),\n  column: { width: 320, stacked: true },\n  dock: { ephemeralTabs: true },\n})\n\nexport default app\n`,
  ),
  file(
    "f-shell",
    "shell.tsx",
    2,
    `export function Shell() {\n  // three strips, never more\n  return (\n    <div className="flex h-full">\n      <Rail />\n      <ContextColumn />\n      <Dock />\n    </div>\n  )\n}\n`,
  ),
  file(
    "f-column",
    "column.tsx",
    2,
    `// list on top, read-only detail stacked BELOW in the same column\nexport function ContextColumn({ surface }) {\n  const [selection, setSelection] = useState(null)\n  return (\n    <aside className="w-[320px]">\n      <List onSelect={setSelection} />\n      {selection ? <Detail selection={selection} compact /> : null}\n    </aside>\n  )\n}\n`,
  ),
  file(
    "f-util",
    "util.ts",
    1,
    `export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))\nexport const uid = () => Math.random().toString(36).slice(2, 9)\n`,
  ),
  file(
    "f-readme",
    "README.md",
    0,
    `# Compact Workbench (demo)\n\nRail -> compact column -> dock.\n\n- rail is the single inventory of plugin surfaces\n- the column is where "browse -> peek" happens\n- the dock is where "work on it" happens\n`,
    "md",
  ),

  {
    id: "a-1",
    surface: "agents",
    label: "refactor SurfaceShell",
    sublabel: "running · opus",
    kind: "chat",
    badge: "live",
    body: `[demo transcript]\n\nuser: split the left pane state machine out of SurfaceShell\nagent: reading packages/workspace/src/front/surface/SurfaceShell.tsx (1,024 lines)\nagent: extracted useLeftPaneState(); 3 call sites updated\nagent: tests pass (42 files, 311 assertions)\nagent: want me to open the diff?`,
  },
  {
    id: "a-2",
    surface: "agents",
    label: "breakpoint token audit",
    sublabel: "idle · sonnet",
    kind: "chat",
    body: `[demo transcript]\n\nuser: find every hardcoded breakpoint\nagent: 3 thresholds found — 640 (ChatLayout), 768 and 1024 (ResponsiveDockviewShell)\nagent: proposing packages/workspace/src/shared/breakpoints.ts`,
  },
  {
    id: "a-3",
    surface: "agents",
    label: "docs: WORKBENCH_SURFACES",
    sublabel: "queued · haiku",
    kind: "chat",
    body: `[demo transcript]\n\nqueued behind the breakpoint audit.`,
  },

  {
    id: "t-1",
    surface: "tasks",
    label: "Single WorkbenchLeftPane mount",
    sublabel: "in progress",
    kind: "task",
    badge: "P1",
    body: `Slice 2 of the migration (demo).\n\nDelete the workbench-left-shell aside from ChatLayout; the only rail/pane is\nthe one inside SurfaceShell. Removes workbenchLeftOpen /\nworkbenchLeftExplicitOpen from WorkspaceAgentFront.\n\nBlocked by: breakpoint tokens.`,
  },
  {
    id: "t-2",
    surface: "tasks",
    label: "Stacked detail block",
    sublabel: "ready",
    kind: "task",
    badge: "P1",
    body: `Slice 3 (demo). Add the optional detail slot below the source pane,\nresizable splitter, read-only by contract. Wire to the filesystem plugin\nonly, behind a columnDetail flag.`,
  },
  {
    id: "t-3",
    surface: "tasks",
    label: "Ephemeral dock tabs",
    sublabel: "blocked",
    kind: "task",
    badge: "P2",
    body: `Slice 5 (demo). Preview semantics: a tab opened from the column starts\nephemeral and is replaced by the next escalation unless pinned.`,
  },
  {
    id: "t-4",
    surface: "tasks",
    label: "Breakpoint tokens",
    sublabel: "done",
    kind: "task",
    body: `Slice 1 (demo). One breakpoints.ts exporting MOBILE / TABLET.`,
  },

  {
    id: "au-1",
    surface: "automations",
    label: "Nightly dependency audit",
    sublabel: "daily · 03:00",
    kind: "automation",
    badge: "on",
    body: `[demo automation]\n\ntrigger: cron 0 3 * * *\nagent: sonnet\nlast run: 03:00 — 2 advisories, 1 PR opened\nnext run: in 9h`,
  },
  {
    id: "au-2",
    surface: "automations",
    label: "PR triage",
    sublabel: "on pull_request",
    kind: "automation",
    badge: "on",
    body: `[demo automation]\n\ntrigger: github pull_request.opened\nagent: opus\nlast run: 14m ago — labelled #1187, requested review`,
  },
  {
    id: "au-3",
    surface: "automations",
    label: "Weekly design digest",
    sublabel: "weekly · Mon",
    kind: "automation",
    badge: "off",
    body: `[demo automation]\n\npaused by owner 3 weeks ago.`,
  },

  {
    id: "s-1",
    surface: "search",
    label: "SurfaceShell.tsx:812",
    sublabel: "railOnly={!sourcePaneOpen}",
    kind: "hit",
    body: `[demo search hit]\n\n810  <WorkbenchLeftPane\n811    activeTab={leftPane.activeTab}\n812    railOnly={!sourcePaneOpen}\n813    onSelect={handleSelectSurface}\n814  />`,
  },
  {
    id: "s-2",
    surface: "search",
    label: "ChatLayout.tsx:373",
    sublabel: 'data-boring-workspace-part="workbench-left-shell"',
    kind: "hit",
    body: `[demo search hit]\n\n371  <aside\n372    style={{ width: sidebarWidth }}\n373    data-boring-workspace-part="workbench-left-shell"\n374  >`,
  },
  {
    id: "s-3",
    surface: "search",
    label: "uiCommandDispatcher.ts:96",
    sublabel: "enqueue(op) // park until surface ready",
    kind: "hit",
    body: `[demo search hit]\n\n 96  function enqueue(op: UiOp) {\n 97    pending.push(op)\n 98    // flushed on surface-ready\n 99  }`,
  },

  {
    id: "i-1",
    surface: "inbox",
    label: "Approve: delete workbench-left-shell",
    sublabel: "from refactor SurfaceShell",
    kind: "intent",
    badge: "needs you",
    body: `[demo human intention]\n\nThe agent wants to remove a persisted layout key\n(\${storageKey}:sidebarWidth). That is a one-time reset for every user.\n\n[ Approve ]   [ Ask for a migration ]   [ Reject ]`,
  },
  {
    id: "i-2",
    surface: "inbox",
    label: "Question: keep plugin-tabs for one release?",
    sublabel: "from breakpoint token audit",
    kind: "intent",
    badge: "needs you",
    body: `[demo human intention]\n\nworkspaceLayout would degrade to appNavPlacement. Keep "pane" behaviour\nbehind a deprecation warning for one release?`,
  },
]

export const itemsFor = (surface: SurfaceId) => ITEMS.filter((i) => i.surface === surface)
export const itemById = (id: string) => ITEMS.find((i) => i.id === id)
