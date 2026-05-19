# @hachej/boring-ask-user

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm](https://img.shields.io/npm/v/@hachej/boring-ask-user.svg)](https://www.npmjs.com/package/@hachej/boring-ask-user)

</div>

Lets the coding agent ask the user a structured question and stream the answer back. Surfaces the question as a workbench panel; the agent's `ask_user` tool blocks until the user responds.

```bash
curl -o install-ask-user.sh https://raw.githubusercontent.com/hachej/boring-ui/main/plugins/ask-user/install.sh | bash
```

---

## TL;DR

**The Problem**: Your agent wants to confirm destructive actions, collect missing parameters, or branch on user choice — but it has no way to pause and wait for a human answer. Chat messages don't provide structured, typed responses.

**The Solution**: The `ask_user` tool lets the agent emit a typed question (text input, choice, multi-select, number). It opens a panel in the workbench. The user fills it in. The agent unblocks and continues with the answer.

### Why Use @hachej/boring-ask-user?

| Feature | What It Does |
|---------|--------------|
| **Typed form fields** | `text`, `choice`, `multi-select`, `number` — validated with Zod |
| **Blocking tool** | Agent calls `ask_user` and waits — the tool resolves only when the user answers |
| **Workbench panel** | Pending question UI with cancel button and validation |
| **Bridge pubsub** | SSE-based communication between agent backend and frontend panel (HTTP fallback) |
| **Question store** | File-based persistence; swap in your own `AskUserStore` for DB-backed |

---

## Quick Example

```bash
pnpm add @hachej/boring-ask-user
```

**Frontend (workbench):**

```ts
import { createAskUserPlugin } from "@hachej/boring-ask-user/front"

const askUserPlugin = createAskUserPlugin()
// Add to WorkspaceProvider plugins array
```

**Server (agent runtime):**

```ts
import { createAskUserServerPlugin } from "@hachej/boring-ask-user/server"

const askUserServerPlugin = createAskUserServerPlugin({ store: yourStore })
// Add to createAgentApp plugins
```

Now the agent has an `ask_user` tool. When it calls it:

```
Agent → ask_user({
  question: "Which environment should I deploy to?",
  fields: [
    { type: "choice", label: "Environment", options: ["staging", "production"], required: true }
  ]
})
```

A panel opens in the workbench. The user picks an option and submits. The agent receives `{ environment: "production" }` and continues.

---

## Use Cases

- **Confirming destructive actions** — "Are you sure you want to delete the `staging` database?"
- **Collecting missing parameters** — "What date range should I query? (start, end)"
- **Branching agent workflows** — "Should I run tests before or after the migration?"
- **Human approval gates** — "Review these changes and approve/reject"
- **Environment selection** — "Target environment for deployment?"

---

## Installation

```bash
# pnpm
pnpm add @hachej/boring-ask-user

# npm
npm install @hachej/boring-ask-user

# from source
cd boring-ui/plugins/ask-user
pnpm install && pnpm build
```

---

## Architecture

```
Agent calls ask_user tool
         │
         ▼
┌─────────────────────────┐
│   askUserServerPlugin   │
│  ├── Creates question   │
│  ├── Stores in store    │
│  └── Posts to UiBridge  │
└───────────┬─────────────┘
            │ SSE / HTTP
            ▼
┌─────────────────────────┐
│  askUserFrontPlugin     │
│  ├── Receives question  │
│  ├── Opens panel        │
│  ├── User fills form    │
│  └── Posts answer       │
└───────────┬─────────────┘
            │ HTTP
            ▼
┌─────────────────────────┐
│   Questions Bridge      │
│  ├── Validates answer   │
│  ├── Resolves promise    │
│  └── Agent continues     │
└─────────────────────────┘
```

### Package Surfaces

| Import | Environment | What You Get |
|--------|-------------|--------------|
| `@hachej/boring-ask-user/front` | Browser | `createAskUserPlugin()` — workbench panel |
| `@hachej/boring-ask-user/server` | Node | `createAskUserServerPlugin()` — agent tool + routes |
| `@hachej/boring-ask-user/shared` | Any | `Question`, `Answer`, field types, error codes |

### Question Schema

```ts
type FieldType = "text" | "number" | "choice" | "multi-select"

interface FormField {
  type: FieldType
  label: string
  required?: boolean
  options?: string[]        // for choice / multi-select
  description?: string
  defaultValue?: string
}

interface AskUserInput {
  question: string
  fields: FormField[]
  timeoutMs?: number        // auto-timeout (default: none)
}

// Agent returns:
type Answer = Record<string, string | string[] | number>
```

---

## Configuration

### AskUserStore Interface

```ts
interface AskUserStore {
  create(question: Question): Promise<string>   // returns questionId
  get(id: string): Promise<Question | null>
  list(): Promise<Question[]>
  answer(id: string, answer: Answer): Promise<void>
  cancel(id: string): Promise<void>
}
```

Default is file-based. Provide your own for DB-backed persistence:

```ts
import { createAskUserServerPlugin } from "@hachej/boring-ask-user/server"

const serverPlugin = createAskUserServerPlugin({
  store: myDatabaseBackedStore,
})
```

---

## How @hachej/boring-ask-user Compares

| Feature | @hachej/boring-ask-user | Chat-based answers | MCP human-in-loop |
|---------|-------------------------|--------------------|--------------------|
| Structured input | ✅ Typed fields with validation | ❌ Free text only | ⚠️ Varies |
| Blocking | ✅ Tool waits for answer | ❌ Agent parses chat | ⚠️ Stdin only |
| Workbench UI | ✅ Panel with form UX | ✅ Chat bubble | ❌ Terminal prompt |
| Cancellation | ✅ User can cancel | ⚠️ Just type something else | ⚠️ Ctrl+C |
| Multi-field | ✅ Multiple typed fields in one question | ❌ One-at-a-time | ❌ |

**When to use @hachej/boring-ask-user:**
- Your agent needs structured, validated answers (not free-text chat)
- You want a proper form UI in the workbench
- You're building approval gates or environment selectors

**When it might not fit:**
- Free-text chat answers are sufficient (just ask in the chat)
- You need real-time collaborative editing (not supported)
- You need terminal-based stdin/stdout (use direct prompt input)

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `ask_user tool not found` | Server plugin not registered | Add `createAskUserServerPlugin()` to your agent app |
| Panel doesn't open | Front plugin not in workspace | Add `createAskUserPlugin()` to `WorkspaceProvider` plugins |
| Answer not reaching agent | Bridge connection broken | Check SSE endpoint is reachable; try HTTP fallback |
| Validation fails | User input doesn't match field schema | Check `required` fields and `options` for choice fields |
| Question times out | `timeoutMs` expired | Increase `timeoutMs` or remove it for no timeout |

---

## Limitations

- **No file upload fields** — The form supports text, number, choice, and multi-select only. File uploads are not in scope.
- **Single question at a time** — Only one pending question is surfaced per session. Concurrent questions queue.
- **No rich text or rich media** — Fields are plain text / numbers / choices. No markdown editors, image pickers, or date pickers.

---

## FAQ

**Q: What happens if the user closes the panel without answering?**  
A: The question remains pending. The agent tool is still blocked. Use the cancel button in the panel to reject it.

**Q: Can the agent ask follow-up questions based on the answer?**  
A: Yes — the agent receives the typed answer and can use it in its next reasoning step, including asking another `ask_user` question.

**Q: How does this differ from just asking in chat?**  
A: Chat responses are unstructured text. `ask_user` returns typed, validated data — `{ environment: "production", confirm: true }` — which the agent can use programmatically without parsing free text.

**Q: Is the question store persistent?**  
A: The default store is file-based (persists across restarts). Swap in your own `AskUserStore` for database-backed persistence.

---

*About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

---

## License

MIT
