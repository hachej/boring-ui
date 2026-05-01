# Agent UI

`@boring/agent` exports the pane-embeddable `ChatPanel` and its frontend
primitives. The default styled surface is packaged with precompiled CSS.

## Quickstart

```tsx
import "@boring/workspace/globals.css"
import "@boring/agent/front/styles.css"
import { ChatPanel } from "@boring/agent"

function App() {
  return <ChatPanel sessionId="my-session" />
}
```

Import app overrides after the package CSS when customizing:

```ts
import "@boring/workspace/globals.css"
import "@boring/agent/front/styles.css"
import "./app.css"
```

## Styling model

| Concern | Contract |
|---|---|
| Package CSS | `@boring/agent/front/styles.css` |
| Root selector | `[data-boring-agent]` |
| Parts | `[data-boring-agent-part="composer"]`, `[data-boring-agent-part="tool-card"]`, etc. |
| Message role | `[data-boring-agent-message-role="assistant"]` |
| State | `[data-boring-state="selected"]`, `[data-boring-state="disabled"]`, etc. |
| Tokens | Consumes host `--boring-*` tokens with standalone fallbacks |

The built stylesheet has no Tailwind `@source` directives, no Tailwind imports,
and no repo-relative source paths.

## Dark mode

Add `class="dark"` to an ancestor. Workspace owns the dark `--boring-*` token
values; agent inherits them and falls back when embedded standalone.

## Custom tool renderers

Same API as `ChatPanel`:

```tsx
<ChatPanel
  sessionId="sess"
  toolRenderers={{
    write: ({ toolCall }) => <div>Wrote {toolCall.input.path}</div>,
  }}
/>
```
