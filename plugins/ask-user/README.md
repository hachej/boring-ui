# @hachej/boring-ask-user

Lets the agent ask the user a structured question and stream the answer back. Surfaces the question as a workbench panel; the agent's `ask_user` tool blocks until the user responds.

```bash
pnpm add @hachej/boring-ask-user
```

---

## What it provides

- **Agent tool** — `ask_user`: declarative form questions with typed fields (text, choice, multi-select, number)
- **Workbench panel** — pending question UI with cancellation, validation, and a notice when no question is pending
- **Bridge** — pubsub between the agent backend and the panel, with HTTP fallback for non-streaming clients

---

## Quickstart

Front (workbench):

```ts
import { createAskUserPlugin } from "@hachej/boring-ask-user/front"

const askUserPlugin = createAskUserPlugin()
```

Pass `askUserPlugin` to your `WorkspaceProvider`'s `plugins` array (see [`@hachej/boring-workspace`](../../packages/workspace/README.md)).

Server (agent runtime):

```ts
import { createAskUserServerPlugin } from "@hachej/boring-ask-user/server"

const askUserServerPlugin = createAskUserServerPlugin({ store: yourStore })
```

The agent now has an `ask_user` tool. Calling it surfaces a question to the user; the tool resolves once the user answers.

---

## Use cases

- Confirming destructive actions before the agent executes
- Collecting missing parameters (date ranges, account IDs, target environments)
- Branching agent workflows on user choice
- Any agent action that needs human approval

---

## Part of [boring-ui](https://github.com/hachej/boring-ui)
