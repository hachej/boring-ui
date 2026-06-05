# Agent Chat + Sessions UX Spec

Status: draft from POC.

## Shape

```text
┌───────────────────────────────────────────────────────────────┐
│ Chat stage                                                     │
│ ┌──────────── chat pane A ────────────┬──── chat pane B ────┐ │
│ │ [grip] [x]                          │ [grip] [x]          │ │
│ │ active pane gets neutral border     │ inactive is normal  │ │
│ │                                     +                    │ │
│ │ composer                            │ composer            │ │
│ └─────────────────────────────────────┴─────────────────────┘ │
└───────────────────────────────────────────────────────────────┘

Single pane:
┌───────────────────────────────────────────────────────────────┐
│ ┌──────────────────── chat pane ───────────────────────────┐ + │
│ │ [grip] [x]                                               │   │
│ │ composer                                                 │   │
│ └───────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

## Session model

- Session history is data; chat panes are views.
- Closing a pane closes the view only, not the run/session.
- Only opened/focused sessions become panes.
- Clicking a session row loads it into the currently active chat pane.
- Clicking row `open-as-tab` opens that session as an additional pane.

```text
Session row click          → replace active pane session
Session row external icon  → open/focus separate pane
Pane close                 → remove view only
Border/edge +              → create new session to the right
```

## Pane controls

- Use DockView native tab/header for drag; fake overlay grips do not work.
- Header controls are compact: drag grip and close only.
- Per-pane `+` belongs on the right edge/divider between panes, not in the pane header.
- With one pane, the `+` floats on the pane's right edge.
- With adjacent panes, the `+` sits on the divider between them.
- Implement the `+` from the chat-stage/DockView overlay layer so it can straddle the divider without being clipped by pane overflow.
- Active pane indication must be neutral but visible: full-pane hairline or header treatment.

## Session drawer

```text
┌ Sessions ────────────── + close ┐
│ Today                         8 │
│ New session  33m        [open↗] │ ← row click replaces active pane
│ New session  36m        [open↗] │ ← icon opens separate pane
└─────────────────────────────────┘
```

- Row and open-as-tab icon need distinct hit areas.
- Open-as-tab icon uses the same external-link visual language as deck open-in-new-tab.
- The drawer reserves space for fixed agent-side floating controls.

## Top bar rule

- Do not show a global top-right `+` once per-pane `+` exists.
- Keep session creation contextual: drawer header `+` and pane border/edge `+`.
