# @hachej/boring-ask-user

Lets the coding agent ask the user a structured, typed question and block until
the answer comes back. The question renders as a form in the **Questions**
workbench pane; the agent's `ask_user` tool resolves once the user submits or
cancels.

## What it does

- Adds an `ask_user` agent tool that emits a typed form schema (text, textarea,
  select, multiselect, checkbox, radio, number) and waits for a validated answer.
- Contributes a **Questions** center pane that renders the pending question,
  validates input (Zod), and posts the answer back.
- Registers a workspace **blocker** while a question is pending, so the
  composer surfaces "Answer the question to continue" with open/cancel actions.
- Persists pending questions to a file store that survives agent restarts.

## What it contributes to the workspace

| Surface | Detail |
|---------|--------|
| Provider | `ask-user.provider` — owns the per-app questions runtime + pending store |
| Panel | `ask-user.questions` ("Questions"), `placement: "center"`, chromeless |
| Surface resolver | kind `questions` (`ASK_USER_SURFACE_KIND`) → opens the panel |
| Agent tool | `ask_user` (blocking; resolves `answered` / `cancelled`) |
| HTTP route | `POST /api/v1/questions/commands` (submit + cancel commands) |
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

The agent then calls `ask_user` with a `{ title, context?, schema }` payload:

```ts
{
  title: "Deploy target?",
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

The pane opens, the user submits, and the tool resolves with
`{ status: "answered", answer: { values: { env: "production" } } }`.

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
one pending question per session (`PENDING_EXISTS` on a duplicate).

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
