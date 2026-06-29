# 02 — Left Pane

Phase 2. Add the app/session navigation left pane after plugin content pages inside the current workspace work.

## Purpose

The left pane is app/session navigation only. It does not own workspace tabs, filetree, plugin pane state, or panel params.

```txt
┌──────────────────────────┐
│ [collapse] [back] [fwd]  │
│                          │
│  +  New chat             │
│  🔎 Search               │
│  🔌 Plugins              │ opens current workspace/plugin content area
│  ✨ Skills               │ skills browser page
│                          │
│  Pinned                  │
│  ──────                  │
│  📌 Session title    📌 ⧉ │
│                          │
│  Sessions                │
│  ────────                │
│  ◷ Session title     📌 ⧉ │
│                          │
│  Theme / user controls   │ optional bottom slot
└──────────────────────────┘
```

Primary items phase 1:

```txt
New chat
Search
Plugins
Skills
```

Automations is hidden until implemented.

## Collapsed behavior

Collapsed means the left pane is removed, except for a top-left overlay icon/control.

```txt
┌───┬───────────────────────────────────────────────────────────────────────────┐
│ ☰ │ MAIN CONTENT                                                              │
└───┴───────────────────────────────────────────────────────────────────────────┘
```

Rules:

```txt
- no icon rail
- no reserved column
- no session labels
- no pinned/session section labels
- no top menu icons except the top-left collapse/uncollapse control
- control keeps aria-label/title
- must not cover first workspace tab activation/close target
```

## Session visual states

```ts
type SessionRowState = "normal" | "open" | "active"
```

```txt
normal: transparent / quiet text
open:   subtle light background
active: stronger background + foreground text
```

## Session click behavior

```txt
click normal session:
  load/switch that session into current primary chat pane

click open inactive session:
  activate existing chat pane

click active session:
  no-op
```

Hover/focus actions:

```txt
pin/unpin:
  toggles pinned state, does not switch session

split/open-in-new-chat-pane icon:
  if not open, open split/additional chat pane and activate
  if already open, activate existing pane
```

## Search

Search opens current command palette plus one extra menu/section:

```txt
Chat session search
```

Chat session result behavior:

```txt
default click = same as session row click, replace/switch current chat pane
hover/focus = show split/open-in-new-chat icon
workspace-tab search = later
```

## Plugins entry

In phase 2, Plugins should open/focus the current workspace plugin content area from `01-plugin-full-pane.md`. It should not introduce an installed plugin catalog/list.

## Skills entry

Skills opens Skills page/list, using the same skill registry/source as the slash command menu. See `05-state-persistence-routing.md` for skill source/editability rules.

## Acceptance

```txt
[ ] Expanded width about 268px
[ ] Collapsed pane removed except top-left overlay control
[ ] Menu has New chat, Search, Plugins, Skills
[ ] No Projects primary item
[ ] No Codex mobile primary item
[ ] Automations hidden
[ ] Pinned sessions section exists
[ ] Regular sessions section exists
[ ] Open sessions have light background
[ ] Active session has stronger background
[ ] Hover/focus shows pin/unpin
[ ] Hover/focus shows split/open-in-new-chat icon
```
