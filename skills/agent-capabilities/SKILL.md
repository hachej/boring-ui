---
name: agent-capabilities
description: Give a Boring UI in-app agent capabilities and gate them safely - custom tools, workspace file access (file guard, present), Approve/Deny approvals, ask_user questions, sub-agents (delegate), schedules, sandboxes and self-evolving tools. Use when asked to "add a tool to the agent", "let the agent edit files", "require approval before X", "ask the user a question", "add a sub-agent/delegate", "schedule a follow-up/reminder", "dry-run/sandbox the agent", "let the agent write its own tools", or when choosing which tools to gate with requireApproval or createApprovalExtension.
---

# Agent capabilities

Every capability is a native Pi tool or extension that you hand to `defineAgent` (from `@hachej/boring-agent/agents`). The host decides what the agent may do. Start from the server in the [build-agent-app skill](../build-agent-app/SKILL.md).

```js
const agent = defineAgent({
  id: 'writer', model: { provider: 'openai', modelId: 'gpt-5-mini' }, instructions: '...',
  tools: [/* tool registrations */],
  extensions: [/* native extensions, in order */],
  delegates: [/* sub-agents */],
});
agent.install(registry);   // before Harness.open
```

## Custom tools

Use Pi's `defineTool` and `Type`. Return text in `output`.

```js
import { defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';

const lookupOrder = defineTool({
  name: 'lookup_order', description: 'Look up a fictional order by its number.',
  parameters: Type.Object({ number: Type.String() }, { additionalProperties: false }),
  execute: async ({ number }) => ({ output: [{ type: 'text', text: JSON.stringify(await orders.get(number)) }] }),
});
```

The host's `execute` owns the data access, credentials and limits. For a tool described by a raw JSON Schema (an MCP `inputSchema`), use `jsonSchemaTool({ name, description, parameters, execute })` from `/agents`.

## Files

- Give the agent Pi's own `createReadTool()`, `createWriteTool()`, `createEditTool()` (and `createBashTool()` with a shell) from `@earendil-works/pi-durable/tools`, in one `defineExtension`.
- Add `createFileGuard({ workspace: { files, root, access } })` from `/file-guard` **after** that extension. It routes `read`/`write`/`edit` through the workspace provider, refuses writes to files the conversation has not read at their current revision, and records agent edits in file history.
- Add `createPresentTool({ workspace })` from `/artifacts` so the agent can open a file in the page.
- Use the **same** `files` provider everywhere (guard, `present`, revision route). Never a second copy.
- Several people, one agent: resolve the workspace per call with `@hachej/boring-agent/workspaces` ([Workspace per call](../../packages/agent/README.md#workspace-per-call)).

## Approvals

Gate a tool so each call waits for the person's Approve or Deny. Deny returns an error starting with `DENIED_PREFIX`, and the tool never runs. Pending approvals survive a restart.

Gate stock or third-party tools by name with an extension:

```js
import { createApprovalExtension } from '@hachej/boring-agent/approval';

const approvals = createApprovalExtension({ tools: {
  write: true, edit: true,
  bash: { summarize: args => `Run: ${args.command}` },
  http_request: { when: args => args.method !== 'GET', summarize: args => `${args.method} ${args.url}` },
} });
defineAgent({ ..., extensions: [fileTools, createFileGuard({ workspace }), approvals] });
```

To turn it on for some conversations only, leave it out of `defineAgent`, call `registry.install(approvals)`, then `conversation.configure({ extensions: { add: [approvals] } })` (and `remove` to turn it off).

Gate a tool you define with `requireApproval(tool, { summarize, when? })`:

```js
tools: [requireApproval(cancelOrder, { summarize: args => `Cancel order ${args.number}` })]
```

The chat transport must accept answers, or the card cannot be answered. Return `answer` from its `authenticate`:

```js
import { answerUserQuestion } from '@hachej/boring-agent/ask-user';
return { conversation, context, abortSubmission, answer: (callId, answer) => answerUserQuestion(conversation, callId, answer, context) };
```

The page passes `chat.actions` from `useRemoteChat` to the chat (see the build-agent-app page template).

### Gate safely

- Gate every tool that changes something: writes, deletes, sends, payments, external calls with effects. Reads stay ungated.
- **Gating only `bash` is not enough.** Pi's `write` and `edit` change files without `bash`. Gate them too, or keep them out of the agent.
- **With `selfEvolving: true`, gating `bash` is bypassable.** Agent-written tools in `.agent/tools/*.json` run their `run` command through the conversation's `ExecutionEnv.exec`, not through the `bash` tool, so a `bash` gate never sees them. The agent can write such a tool with `write`, call `reload`, then run any command. Gate `write` and `edit` (the way into `.agent/`), and choose an `ExecutionEnv` whose isolation you accept, because isolation is where `exec` runs ([SELF-EVOLUTION.md](../../docs/architecture/SELF-EVOLUTION.md)).
- **Code mode:** never expose a gated tool to a code-mode sandbox (`run_code`); its nested calls cannot reach a person. Give it read tools only and filter with `isApprovalGated(tool)`.
- Two approval extensions on one tool ask once; the first selected rule decides.
- The check runs in host code inside the tool, so the model cannot skip it. The `summarize` text is what the person approves: make it name the effect.

## Questions

```js
import { createAskUserTool } from '@hachej/boring-agent/ask-user';
tools: [createAskUserTool()]
```

`ask_user({ question, options?, allowFreeText?, questions? })` waits durably for the person's answer and shows a question card. It needs the same `answer` wiring as approvals. Tell the agent in `instructions` when to ask instead of guessing. Details: [Asking the person](../../packages/agent/README.md#asking-the-person).

## Sub-agents

Define the child with `defineAgent`, then list it in `delegates`. Each becomes a `delegate`-style tool; `install(registry)` installs the child too.

```js
const researcher = defineAgent({ id: 'researcher', model, instructions: 'Read and summarise. Never write.', extensions: [readOnlyFiles] });
const writer = defineAgent({ id: 'writer', model, delegates: [{ agent: researcher, name: 'research' }], extensions: [fileTools] });
```

The child runs in its own conversation with only its own tools and returns its final text. Give children the narrowest tools. Gates on the parent do not apply to the child: gate the child's tools on the child.

## Schedules

```js
import { createScheduleExtension } from '@hachej/boring-agent/schedule';
defineAgent({ ..., extensions: [createScheduleExtension()] });
```

The agent gets `schedule({ instruction, delaySeconds | at })`, `list_schedules()` and `cancel_schedule({ id })`. A schedule is a Pi task that sleeps on the Harness clock and then submits the instruction to its conversation, so it survives restarts. Hosts schedule from code with `addSchedule`, `cancelSchedule` and `listSchedules`. On a host with one wake-up timer (a Durable Object alarm), use `onDeadline` and `scheduledDeadline`. Details: [Sub-agents and schedules](../../packages/agent/README.md#sub-agents-and-schedules).

## Dry runs (sandbox)

`createSandboxExtension({ tools, flags? })` from `/sandbox` records calls to mutating tools instead of running them, and blocks any tool it does not name. Select it per conversation as the **last** wrap, after any approval extension, and check the order with `assertSandboxLast(selected, sandbox)` over the complete list you pass to `conversation.configure({ extensions: selected })`. See [Approval gate](../../packages/agent/README.md#approval-gate).

## Self-evolving agents

`defineAgent({ ..., selfEvolving: true, workspace })` lets the agent keep instructions, skills and tools in `.agent/` and apply them with `reload`. Off by default. Agent-written code only runs through the conversation's `ExecutionEnv`; never import or eval workspace content in the host. Read the gating rules above before turning it on.

## Rules

- Capabilities are host code. The model only calls what you registered.
- Credentials stay in `execute`, resolved per call. Never put them in instructions or tool output.
- Fictional data in prompts, seeds and tests.

## Verify

1. `node server.mjs` starts and `agent.install(registry)` throws nothing (a duplicate tool or extension name throws).
2. Ask the agent to change something gated: an approval card appears, Deny leaves the file or record unchanged, Approve runs it once.
3. With `selfEvolving: true`: ask the agent to add a tool in `.agent/tools/`. The `write` must ask for approval first.
4. Ask a question that needs a choice: the question card appears and the answer resumes the turn.
5. Restart the server with a pending approval or schedule: it is still pending afterwards.
6. Repository tests that cover these: `test/packages/agent-ask-user.test.mjs` (approvals and questions), `test/packages/agent-sandbox.test.mjs` (sandbox order).
