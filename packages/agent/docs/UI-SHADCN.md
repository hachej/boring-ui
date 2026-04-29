# UI-shadcn

`@boring/agent/ui-shadcn` provides a Tailwind + shadcn styled `ChatPanel` that
is visually on par with the Vercel chatbot template. It shares the same
`useAgentChat` hook, the same `ChatPanelProps` API, and the same slash-command
system as the bare `@boring/agent/ui` surface.

## Two UI flavors

| | `@boring/agent` (bare) | `@boring/agent/ui-shadcn` |
|---|---|---|
| Import | `import { ChatPanel } from '@boring/agent'` | `import { ChatPanel } from '@boring/agent/ui-shadcn'` |
| Styling | CSS-var tokens only, zero framework | Tailwind v4 + shadcn/ui |
| Primitives | Custom lightweight primitives | Vendored ai-elements (Message, Conversation, Reasoning, PromptInput, CodeBlock) |
| Theme mechanism | `[data-boring-chat]` CSS vars | shadcn CSS vars (--background, --foreground, etc.) |
| When to use | Embed inside an existing design system | Standalone apps, Vercel-style chatbot UIs |

Both APIs are permanent. `@boring/agent/ui` will never be deprecated.

## Quickstart

```bash
pnpm add @boring/agent tailwindcss @tailwindcss/postcss
```

```tsx
import '@boring/agent/ui-shadcn/styles.css'
import { ChatPanel } from '@boring/agent/ui-shadcn'

function App() {
  return (
    <div className="dark h-screen bg-background text-foreground">
      <ChatPanel sessionId="my-session" />
    </div>
  )
}
```

## Peer dependencies

- `tailwindcss` ^4.1 (required for utility classes in primitives)
- `react` ^19
- `react-dom` ^19

## Styles

Two consumption modes:

### With your own Tailwind setup (recommended)

```css
/* app.css */
@import 'tailwindcss';
@import '@boring/agent/ui-shadcn/styles.css';

@theme {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  /* ... map CSS vars to Tailwind colors */
}
```

### Prebuilt CSS (no Tailwind config)

```ts
import '@boring/agent/ui-shadcn/styles.css'
```

This gives you the CSS custom properties for light/dark themes but you still
need Tailwind installed for the utility classes used internally by the
primitives.

## Dark mode

Add `class="dark"` to an ancestor element. The globals.css defines both `:root`
(light) and `.dark` (dark) token sets.

## Custom tool renderers

Same API as bare ChatPanel:

```tsx
import { ChatPanel, type ToolPart, type ToolRenderer } from '@boring/agent/ui-shadcn'

const myRenderer: ToolRenderer = (part: ToolPart) => (
  <div className="rounded-lg border bg-card p-3">
    {JSON.stringify(part.output)}
  </div>
)

<ChatPanel sessionId="s" toolRenderers={{ my_tool: myRenderer }} />
```

## Building blocks

All primitives are re-exported for custom composition:

```tsx
import {
  Message, MessageContent, MessageResponse,
  Conversation, ConversationContent,
  Reasoning, ReasoningTrigger, ReasoningContent,
  PromptInput, PromptInputTextarea, PromptInputSubmit,
  CodeBlock,
} from '@boring/agent/ui-shadcn'
```

The `cn()` utility (clsx + tailwind-merge) is also exported.

## Example

See [`apps/agent-playground`](../../../apps/agent-playground/) for a complete
working app with Vite + Tailwind v4 + dark mode.
