# Navigation UX Overview Spec

Status: draft from leftbar/chat POC visual iterations.

## Goal

Separate workspace navigation from agent control while keeping both reachable from the main shell.

```text
┌─────────────────────────────────────────────────────────────────────┐
│ App top bar                                      Search / host chrome │
├───────────────┬───────────────────────────────┬─────────────────────┤
│ Agent rail    │ Chat stage / Agent control    │ Workspace surface   │
│ Chat/Sessions │                               │ files/editors/panes │
│ Agent         │                               │                     │
└───────────────┴───────────────────────────────┴─────────────────────┘
```

## Decisions

- Workspace left rail contains workspace/plugin categories only.
- Agent side owns chat, sessions, memory/skills, tools, plugins, and settings.
- Agent control opens from an agent-neutral floating control, not a workspace tab.
- Opening Agent control replaces the chat stage; it does not open in the workspace surface.
- Memory and skill files are listed by Agent control but edited in the workspace editor.

## Non-goals

- Do not overload workspace `left-tab` plugins for agent settings or session history.
- Do not auto-open every historical chat as a DockView pane.
- Do not put a persistent workspace rail in collapsed mode; collapsed means absent except stable reopen control.

## Success criteria

- A user can answer: “Am I navigating workspace content, or controlling the agent?”
- One opened chat session equals one chat pane/tab.
- Active workspace category visually belongs to its content pane.
- Active chat pane is recognizable without loud color.
