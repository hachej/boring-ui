---
name: show-me
description: Help the user understand the current topic visually with concise diagrams, code-shape sketches, and focused HTML artifacts.
disable-model-invocation: true
---

Invoke explicitly with `/skill:show-me [topic]`.

Help the user understand the current topic of conversation visually. Skip the preamble and keep prose brief. Pick the smallest view that makes the key point clear.

- Show logic or an algorithm as pseudocode:

```text
on(save)
  if content is unchanged
    return cached result
  write new content
  return fresh result
```

- Show runtime control flow as a call tree:

```text
submitForm
  createSession
    persistPrompt
    launchAgent
  navigateToSession
```

- Show UI structure as a component tree, including state and module boundaries that matter:

```tsx
<SessionPage> (apps/example/src/routes/session.tsx)
  useSessionEvents()
  <SessionToolbar>
    <RunSkillButton> (packages/ui)
```

- Show file responsibility or a broad refactor as a shallow file tree:

```text
src/
├── commands/       # parses user actions
├── sessions/       # owns session state
└── transport/      # sends API requests
```

- Show component interaction, control flow, or data flow with Mermaid:

```mermaid
sequenceDiagram
    participant User
    participant UI
    participant Daemon
    User->>UI: choose command
    UI->>Daemon: send expanded prompt
    Daemon-->>UI: stream result
```

- Use `diff` when the point is what changes and the surrounding shape already exists. Match the diff shape to the topic.

For a component change:

```diff
 <SessionPage>
   useSessionEvents()
   <SessionToolbar>
+    <RunSkillButton />
   <SessionTimeline>
+    <SkillResultCard />
```

For a file-layout change:

```diff
 src/
 ├── commands/
+│   └── show-me.ts       # expands the slash command
 ├── sessions/
-└── transport.ts
+└── transport/
+    ├── client.ts
+    └── stream.ts
```

For a call-tree or call-stack change:

```diff
 submitForm
   createSession
     persistPrompt
+    expandSkillMention
     launchAgent
-  navigateToSession
+  navigateToSession
+    subscribeToEvents
```

For a state or control-flow change:

```diff
 on(save)
-  write content
+  if content is unchanged
+    return cached result
+  write new content
+  invalidate cache
```

- Show the whole block when most of it is new, when omitted context would hide ownership or order, or when the user needs a copyable target shape:

```ts
function expandSkill(command: string): string {
  const skillName = command.slice(1)
  return `use the ${skillName} skill`
}
```

- For a visual UI, layout, state comparison, or concept too dense for Mermaid, write one focused HTML file — a diagram, an infographic, or a short slide deck, whichever fits the point. Match the product's colors, type, spacing, and components; use real labels and data; support desktop and mobile. Then open it for the user:

```
Bash(open path/to/show-me-{description}.html)
```

### guidance

Place each visual next to the short text it supports. Keep only the calls, files, props, states, and boundaries needed to answer the user's current question or the options to resolve the current discussion point.

Compose complementary views when one view cannot explain the topic well. Each view
must answer a distinct question; omit it when another view already makes that point
clear. A useful order is structure → behavior → contract → experience.

| Question to answer | Use |
| --- | --- |
| What owns this UI and its state? | component tree |
| What executes, and in what nesting? | call tree / call stack |
| Which states and transitions are allowed? | state diagram |
| Who acts first across components or services? | sequence diagram |
| Where does each responsibility live? | shallow file layout |
| Which policy or algorithm branches matter? | pseudocode |
| What contract must callers satisfy? | types and signatures |
| What changed inside a mostly familiar shape? | `diff` syntax |
| What should the visual UI or interaction feel like? | focused HTML mockup |

Use `diff` syntax when shared context dominates; show the whole tree, block, or
signature when most of it is new. Keep each view focused—usually under about 12
nodes or lines—but do not impose a fixed number of views. Use one, several, or
rarely many; stop when the user can see the answer without reading a wall of prose.

## Attribution

Adapted from HumanLayer’s MIT-licensed `show-me` skill. The pinned upstream source and license are preserved in [`.agents/skill-references/show-me/humanlayer-show-me/`](../../skill-references/show-me/humanlayer-show-me/).
