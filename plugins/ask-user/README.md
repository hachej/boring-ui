# @hachej/boring-ask-user

Lets the coding agent ask the user a structured, typed question. Questions are
blocking by default; `blocking: false` creates the same durable Inbox form and
returns immediately, then delivers the owner's answer to the asking session as
a follow-up prompt.

## What it does

- Adds an `ask_user` agent tool that emits a typed form schema (text, textarea,
  select, multiselect, checkbox, radio, number) and either waits for a validated
  answer or returns a durable pending receipt.
- Contributes a **Questions** center pane that renders the pending question,
  validates input (Zod), and posts the answer back.
- Registers a workspace **blocker** while a blocking question is pending, so the
  composer surfaces "Answer the question to continue" with open/cancel actions.
- Persists pending questions to a file store that survives agent restarts.

## What it contributes to the workspace

| Surface | Detail |
|---------|--------|
| Provider | `ask-user.provider` — owns the per-app questions runtime + pending store |
| Panel | `ask-user.questions` ("Questions"), `placement: "center"`, chromeless |
| Surface resolver | kind `questions` (`ASK_USER_SURFACE_KIND`) → opens the panel |
| Agent tool | `ask_user` (blocking by default; non-blocking returns `pending`) |
| WorkspaceBridge ops | `ask-user.v1.request`, `ask-user.v1.answer`, `ask-user.v1.cancel`, `ask-user.v1.pending`, `ask-user.v1.transcript` |
| Pi prompt | `pi.systemPrompt` nudges the agent to use `ask_user` over chat roleplay |

## How it's wired

Both entrypoints have a default export, so the package works as a
`defaultPluginPackages` entry as well as via the named factories.

**Front** — pass the `askUserPlugin` const directly to `WorkspaceProvider`:

```ts
import { askUserPlugin } from "@hachej/boring-ask-user/front"
// <WorkspaceProvider plugins={[askUserPlugin, ...]}>
```

It bundles a provider, so compose it statically in the app shell rather than
relying on dynamic hot-load.

**Server** — register the server plugin with the agent runtime:

```ts
import { createAskUserServerPlugin } from "@hachej/boring-ask-user/server"

const plugin = createAskUserServerPlugin({
  workspaceRoot,   // required unless you pass your own `store`
  bridge,          // UiBridge — needed for live SSE state publishing
  store,           // optional; defaults to FileAskUserStore
  sessionId,       // optional string | () => string
})
```

The package's default server adapter wires follow-up delivery through the
trusted workspace agent dispatcher. Hosts that call the named factory directly
must provide `answerDeliveryTransport` to enable non-blocking answer delivery.

The agent then calls `ask_user` with a `{ title, context?, schema, blocking? }` payload:

```ts
{
  title: "Deploy target?",
  blocking: false,
  schema: {
    wireVersion: 1,
    fields: [
      { type: "select", name: "env", label: "Environment", options: [
        { value: "staging", label: "Staging" },
        { value: "production", label: "Production" },
      ] },
    ],
  },
}
```

With the default `blocking: true`, the pane opens and the tool resolves with
`{ status: "answered", answer: { values: { env: "production" } } }` after the
owner submits. With `blocking: false`, it returns immediately with
`{ questionId, status: "pending", blocking: false }`.

When a non-blocking question is answered, the plugin sends the asking session a
fixed sentence identifying the payload as untrusted owner answer data, followed
by a clearly delimited JSON block. Titles, labels, and values stay inside that
data envelope and are never interpolated as prompt instructions. If the session
is busy, the answer remains marked
`undelivered` in the store and is retried on boot, on the next answer, and on a
timer tick. A stable request id derived from the question id makes delivery
idempotent across retries and restarts. The Inbox labels these questions
`non-blocking`; the Answered tab shows `undelivered` or `delivered`.

Submit/cancel/pending/transcript traffic goes through WorkspaceBridge
`ask-user.v1.*` operations. The old `questionsRoutes` helper for
`POST /api/v1/questions/commands` remains exported only for manual legacy
wiring; `createAskUserServerPlugin` does not register that route.

Non-blocking `ask-user.v1.request` calls must carry an `agentTypeId`. The host
accepts them only when the trusted runtime context names an owner and its
dispatcher authorizes that exact `(workspaceId, owner, agentTypeId, sessionId)`
tuple. A caller cannot select another session's delivery coordinates. Direct
`agentToolFactory` tools receive the same coordinates from their verified host
execution context.

## Field types

`text`, `textarea`, `select`, `multiselect`, `checkbox`, `radio`, `number`.
Every field needs `name` (keys into the answer) and `label`; common optionals
are `required`, `helpText`, `defaultValue`. `select`/`multiselect`/`radio` take
`options: { value, label, description? }[]`. Schema limits (max 8 fields, 50
options/field, etc.) live in `ASK_USER_SCHEMA_LIMITS`.

Answer values are `string | string[] | boolean | number | null`, keyed by field
name under `answer.values`.

## Config & storage

The default `FileAskUserStore` persists to
`${workspaceRoot}/.boring/ask-user.json`. Implement the `AskUserStore`
interface and pass it as `store` for DB-backed persistence. The store enforces
one pending blocking question per session (`PENDING_EXISTS` on a duplicate). A
session may have multiple pending non-blocking questions so batch work can
continue while the owner decides.

Every detail, list, answer, cancel, and transcript read is scoped to the bridge
context's `workspaceId`; browser access is additionally scoped to the verified
owner principal. Records written before `workspaceId` was persisted are visible
only when the host assigns the store file to its creating workspace through
`legacyWorkspaceId`. Leave that option unset for a shared or ambiguously owned
store, which hides legacy records rather than exposing them across workspaces.

Abuse control uses separate per-session minute buckets: 6 blocking asks and 30
non-blocking asks by default. Both also consume the shared owner-principal limit
of 30 asks per hour.

## Package surfaces

| Import | Env | Exports |
|--------|-----|---------|
| `@hachej/boring-ask-user/front` | Browser | `askUserPlugin` (default + named) |
| `@hachej/boring-ask-user/server` | Node | `createAskUserServerPlugin`, `AskUserStore`, `FileAskUserStore`, runtime/bridge/route helpers; default export = `defaultPluginPackages` adapter |
| `@hachej/boring-ask-user/shared` | Any | schema/types/constants/error codes |

## Notes

- No file-upload, rich-text, or date-picker fields.
- If the agent process restarts mid-question, the question stays pending in the
  file store; the front pane re-reads pending state on focus / agent stream
  activity.

## Validation

```bash
pnpm --filter @hachej/boring-ask-user typecheck
pnpm --filter @hachej/boring-ask-user test
pnpm --filter @hachej/boring-ask-user build
```

## License

MIT
