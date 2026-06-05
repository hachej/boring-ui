# Agent Control + Knowledge UX Spec

Status: draft from POC.

## Goal

Make the collapsed agent side an agent cockpit, not a chat-history drawer.

```text
Floating controls
┌───────┐
│ ↺     │ Sessions, only in Chat mode
│ Chat  │ Return to chat stage
│ Agent │ Open agent control stage
└───────┘
```

## Agent control stage

Agent control replaces the chat stage.

```text
┌──────────────────────────────────────────────┐
│ Agent / Control center                  back │
├──────────────────────────────────────────────┤
│ Resume chat                                  │
│                                              │
│ Knowledge                                    │
│  profile.md                                  │
│  project.md                                  │
│  decisions.md                                │
│  skills/.../SKILL.md                         │
│                                              │
│ Plugins + tools                              │
│ Settings                                     │
└──────────────────────────────────────────────┘
```

## Ownership

- Agent owns memory, skills, tools, plugins, model settings, and session state.
- Workspace owns editors and file surfaces.
- Clicking memory/skill docs opens files in workspace editor via UI command.

```text
Agent control list item
  → dispatch openFile(.boring-agent/...md)
  → workspace opens editor pane
```

## Storage convention

- Boring-native v1 uses workspace-local Markdown under `.boring-agent/`.
- Provider-backed memory can come later behind adapters.

```text
.boring-agent/
  memory/
    profile.md
    project.md
    decisions.md
  skills/
    boring-plugin-build/
      SKILL.md
```

## Interaction rules

- Agent button label/icon must be neutral: “Agent”, not “Chat settings”.
- Opening Agent control must not close session drawer implicitly unless needed for space.
- Agent control internal navigation should live inside the stage, not in workspace left rail.
