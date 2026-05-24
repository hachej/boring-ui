# @hachej/boring-ask-user

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

Lets the coding agent ask the user a structured question and stream the answer back. Surfaces the question as a workbench panel; the agent's `ask_user` tool blocks until the user responds.

```bash
git clone https://github.com/hachej/boring-ui.git && cd boring-ui && pnpm install
```

> **Note:** This plugin is workspace-private (`"private": true`) — install from source within the monorepo.

---

## TL;DR

**The Problem**: Your agent wants to confirm destructive actions, collect missing parameters, or branch on user choice — but it has no way to pause and wait for a structured, typed answer. Chat messages don't provide validated form input.

**The Solution**: The `ask_user` tool lets the agent emit a typed schema (text, textarea, select, multiselect, checkbox, radio, number fields). It opens a form panel in the workbench. The user fills it in. The agent unblocks with a typed `Record<string, AskUserAnswerValue>` response.

### Why Use @hachej/boring-ask-user?

| Feature | What It Does |
|---------|--------------|
| **Typed form fields** | `text`, `textarea`, `select`, `multiselect`, `checkbox`, `radio`, `number` — validated with Zod |
| **Blocking tool** | Agent calls `ask_user` and waits — resolves with `answered` or `cancelled` status |
| **Workbench panel** | Questions pane with submit/cancel buttons, form validation, and empty state |
| **WorkspaceBridge-backed** | Agent requests use `human-input.v1.request`; browser submit/cancel use `human-input.v1.answer` / `human-input.v1.cancel` |
| **Workspace-owned store** | Pending questions live in the workspace `human-input` coordinator; core/cloud can inject a store later |
| **Surface resolver** | Agent opens the questions panel via a `human-input` / Questions surface effect; refresh rehydrates from `human-input.v1.pending` |

---

## Quick Example

**Frontend (workbench):**

```ts
import { askUserPlugin } from "@hachej/boring-ask-user/front"
// const already — no factory. Add directly to WorkspaceProvider plugins.
```

Pass `askUserPlugin` to your `WorkspaceProvider`'s `plugins` array. This front plugin includes a provider/binding, so compose it statically in the app shell rather than relying on dynamic package hot-load.

**Agent runtime:**

```ts
import { createAskUserPiExtensionFactory } from "@hachej/boring-ask-user/agent"

createWorkspaceAgentServer({
  pi: {
    extensionFactories: [
      createAskUserPiExtensionFactory({
        sessionId: () => activeSessionId,
        callHumanInputRequest: (input, signal) => workspaceBridgeRegistry.call({
          op: "human-input.v1.request",
          requestId: input.requestId,
          input,
        }, trustedRuntimeBridgeContext(signal)),
      }),
    ],
  },
})
```

The old `@hachej/boring-ask-user/server` route/tool surface is intentionally removed. Do not register `WorkspaceServerPlugin.agentTools` for ask-user.

The agent now has an `ask_user` tool. The agent calls it with:

```ts
{
  title: "Deploy target?",
  context: "Choose the environment.",
  schema: {
    wireVersion: 1,
    fields: [
      { type: "select", name: "env", label: "Environment", options: [
        { value: "staging", label: "Staging" },
        { value: "production", label: "Production" },
      ]},
    ],
  },
}
```

A panel opens in the workbench. The user picks an option and clicks "Send answers." The agent receives `{ status: "answered", answer: { values: { env: "production" } } }` and continues.

---

## Field Types

| Type | Values | Key Props |
|------|--------|-----------|
| `text` | `string` | `placeholder`, `defaultValue`, `minLength`, `maxLength`, `pattern` |
| `textarea` | `string` (multi-line) | `placeholder`, `defaultValue`, `minLength`, `maxLength` |
| `select` | `string` (single) | `options: AskUserOption[]`, `defaultValue` |
| `multiselect` | `string[]` | `options`, `defaultValue[]`, `minSelections`, `maxSelections` |
| `checkbox` | `boolean` | `defaultValue` |
| `radio` | `string` (single) | `options`, `defaultValue` |
| `number` | `number` | `min`, `max`, `step`, `integer`, `defaultValue` |

Each field requires `name: string` (keys into the answer) and `label: string`. Optional: `required`, `helpText`, `defaultValue`.

`AskUserOption = { value: string; label: string; description?: string }`.

---

## Answer Types

```ts
type AskUserAnswerValue = string | string[] | boolean | number | null

type AskUserAnswer = {
  questionId: string
  sessionId: string
  values: Record<string, AskUserAnswerValue>  // keyed by field name
  submittedAt: string
}
```

---

## Installation

```bash
# From source (workspace-only — not published to npm)
cd boring-ui/plugins/ask-user
pnpm install && pnpm build
```

---

## Architecture

```
Agent calls ask_user Pi extension
         │
         ▼
┌─────────────────────────┐
│ human-input.v1.request  │
│ WorkspaceBridge handler │
│  ├── Creates question   │
│  ├── Stores in workspace│
│  │   human-input store  │
│  └── Emits UI effect    │
└───────────┬─────────────┘
            │ human-input surface + pending query
            ▼
┌─────────────────────────┐
│  askUserPlugin (front)  │
│  ├── Rehydrates pending │
│  ├── Opens panel        │
│  ├── Renders form       │
│  │   (schema-driven)    │
│  └── Calls bridge       │
└───────────┬─────────────┘
            │ human-input.v1.answer / cancel
            ▼
┌─────────────────────────┐
│ WorkspaceBridge runtime │
│  ├── Validates nonce    │
│  ├── Resolves waiter    │
│  └── Agent continues    │
└─────────────────────────┘
```

### Package Surfaces

| Import | Environment | What You Get |
|--------|-------------|--------------|
| `@hachej/boring-ask-user/front` | Browser | `askUserPlugin` const — workbench provider + panel + surface resolver |
| `@hachej/boring-ask-user/agent` | Node/Pi host | `createAskUserPiExtensionFactory()` — bridge-backed `ask_user` tool |
| `@hachej/boring-ask-user/shared` | Any | `AskUserField`, `AskUserFormSchema`, `AskUserToolInput`, error codes, constants |

`@hachej/boring-ask-user/server` is no longer a public export. Old `/api/v1/questions/commands` routes are historical only and must not be used in supported setups.

### AskUserStore Interface

```ts
interface AskUserStore {
  getPending(sessionId: string): Promise<AskUserQuestion | null>
  getByQuestionId(questionId: string): Promise<AskUserQuestion | null>
  createPending(question: AskUserQuestion): Promise<void>
  answer(questionId: string, answer: AskUserAnswer): Promise<void>
  cancel(questionId: string): Promise<void>
  markAbandoned(questionId: string): Promise<void>
  clearPending(sessionId: string): Promise<void>
  appendTranscriptEvent(event: AskUserTranscriptEvent): Promise<void>
  listTranscriptEvents(sessionId: string): Promise<AskUserTranscriptEvent[]>
  getTranscriptEventsForQuestion(questionId: string): Promise<AskUserTranscriptEvent[]>
  subscribe(listener: (change: AskUserStoreChange) => void): () => void
}
```

The legacy `AskUserStore` types remain for archived server-route tests only. Supported setups use the workspace-owned pending-question store behind `human-input.v1.*`; hosts that need DB persistence should inject a pending-question store into the workspace bridge composition.

---

## How @hachej/boring-ask-user Compares

| Feature | @hachej/boring-ask-user | Chat-based answers | MCP human-in-loop |
|---------|-------------------------|--------------------|--------------------|
| Structured input | ✅ 7 typed fields with Zod validation | ❌ Free text only | ⚠️ Varies |
| Blocking | ✅ Tool waits for answer | ❌ Agent parses chat | ⚠️ Stdin only |
| Workbench UI | ✅ Form panel with validation | ✅ Chat bubble | ❌ Terminal prompt |
| Cancellation | ✅ User can cancel | ⚠️ Just type something else | ⚠️ Ctrl+C |
| Multi-field | ✅ Multiple fields in one question | ❌ One-at-a-time | ❌ |
| Transcript | ✅ Full event log per question | ❌ None | ❌ |

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
| `ask_user tool not found` | Pi extension factory not registered | Add `createAskUserPiExtensionFactory(...)` to the host's Pi `extensionFactories` |
| Panel doesn't open | Front plugin not in workspace or human-input surface not emitted | Add `askUserPlugin` to `WorkspaceProvider` plugins array and verify `human-input.v1.request` succeeds |
| Answer not reaching agent | WorkspaceBridge auth/capability/nonce problem | Check `/api/v1/workspace-bridge/call` response and browser auth headers |
| Validation fails | User input doesn't match field schema | Check `required` fields, `options` for select fields, and `name` field keys |
| `PENDING_EXISTS` error | Another question is pending | Cancel or answer the existing question first |

---

## Limitations

- **Workspace-private** — `"private": true` in package.json. Not published to npm. Install from source within the monorepo.
- **No file upload fields** — The form supports text, textarea, select, multiselect, checkbox, radio, and number only.
- **Single question per session** — The store enforces one pending question per session (`PENDING_EXISTS` error on duplicate).
- **No rich text or rich media** — Fields are plain text / numbers / selections. No markdown editors, image pickers, or date pickers.
- **Agent process restart clears pending** — If the agent restarts mid-question, the question becomes `abandoned` (the file store persists but no listener is active).

---

## FAQ

**Q: What happens if the user closes the panel without answering?**  
A: The question remains pending. The agent tool is still blocked. Use the cancel button in the panel to reject it.

**Q: Can the agent ask follow-up questions based on the answer?**  
A: Yes — the agent receives the typed answer values and can use them in its next reasoning step, including asking another `ask_user` question.

**Q: How does this differ from just asking in chat?**  
A: Chat responses are unstructured text. `ask_user` returns typed, validated data — `{ env: "production" }` — which the agent can use programmatically without parsing free text.

**Q: Is the question store persistent?**  
A: The default `FileAskUserStore` persists to a JSON file and survives restarts. Swap in your own `AskUserStore` for database-backed persistence.

**Q: What happens if the agent process restarts mid-question?**  
A: The question stays pending in the file store. On the next agent call, the tool will find a pending question and can either resume or mark it abandoned. The front panel also refreshes on page focus to pick up any pending state.

---

*About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

---

## License

MIT
