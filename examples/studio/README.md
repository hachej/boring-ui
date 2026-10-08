# Studio example

One standard agent, shown the way a product would use the library: a durable native Pi Harness, the registry blocks below and the viewers in a real browser. All content is fictional.

## The workspace example: blocks it assembles

The studio is the one reference page that assembles the full workspace. Each block is imported from `registry/` the way a copied-in consumer imports it ([install commands and when to pick which](../../registry/README.md#blocks-what-to-install)):

| Block | What the studio uses it for |
| --- | --- |
| `pi-app` | `AgentWorkspace`, the page layout: the sessions pane (a drawer below 901px), the chat, and the artifact / file viewers in the panel (versions, auto-open). The studio adds its own panel view (the Workspace tabs), the canvas viewer, share links and the variant header |
| `pi-chat` | the conversation (`PiChat`), composer features, cards |
| `pi-workspace` | `ArtifactWorkspace` (inside `pi-app`): the resizable panel, full screen, phone sheet, float-when-narrow |
| `pi-ambient` | `AmbientChat`, the chat's floating form when the workspace is narrower than `floatBelow` |
| `viewers` | the panes inside the panel (Markdown, HTML, image, PDF) |
| variants and scenarios | below: where tools run, and what a person can ask |

To embed an agent beside an existing site instead, see [`examples/ambient`](../ambient/README.md).

The studio used to be thirteen demos, each with its own agent, tools and panel; they drifted apart. It is now three separate things:

| What | Where | It is |
| --- | --- | --- |
| The agent | `examples/shared/standard-agent.mjs` | one `defineAgent(...)` shared with the Cloudflare recipe: artifacts, one shared document, `ask_user`, skills, and, when the host has what they need, canvas, workspace files, a shell, git, subagents and code mode |
| Variants | `variants/*.mjs` | **infrastructure only**: where tools execute, where resources are stored, which models, whether it can run at all |
| Scenarios | `scenarios/*.mjs` | **data**: what a person can ask of the agent, listed in the empty chat and executed by the journey through the real UI |

The agent, the UI, the panel and the composer are identical for every variant. Pick the variant in the header.

## Run

```sh
npm run build
OPENAI_API_KEY=... npm run studio            # http://127.0.0.1:4180, data in .cache/studio
OPENAI_API_KEY=... npm run studio:headless   # the same agent with no server or UI: a letter, then its review
OPENAI_API_KEY=... CHROMIUM=/path/to/chromium npm run studio:journey
CHROMIUM=/path/to/chromium npm run studio:journey:scripted   # the blocking layer: no key (see "Two test layers")
STUDIO_VARIANT=vercel npm run studio:journey            # variants to run: local (default), vercel, local,vercel or all
STUDIO_ONLY=artifacts,chat-stop,menus npm run studio:journey   # scenario ids, group names (kebab-case) or UI journey names
STUDIO_SECURE=1 npm run studio:journey                  # debugging: 127.0.0.1 (secure context) instead of the default insecure origin
```

`npm run studio:journey` is the real-model run (the smoke layer below picks five scenarios from it). Against a real model a failing scenario is tried once more in a new conversation (`STUDIO_RETRIES`, default 1; the first failure is printed), because a real model sometimes answers in text where a tool call was asked for. The blocking layer never retries.

The journey opens the studio at `http://insecure.test:<port>/` (Chromium maps the name to the local server), which browsers treat as an
insecure context like a private-IP HTTP address: no `crypto.randomUUID`, `crypto.subtle`, `navigator.clipboard` or `navigator.share`. The first
step asserts that. Studio and library code must use `@hachej/boring-files/platform` for those; `npm run check` enforces it. `STUDIO_SECURE=1` runs the
journey on `127.0.0.1` (a secure context) instead, for debugging.

Set `STUDIO_PROVIDER=anthropic` with `ANTHROPIC_API_KEY` to use Anthropic models (pass model IDs through `startStudio({ models })`). The bearer
token is a per-process local fixture, not an identity provider.

## Testing behind a proxy (headless)

Load balancers and proxies close a response that sends nothing for their idle timeout (an AWS ALB after 60 s by default), buffer it
(nginx) or compress it. The chat watch stream therefore sends `{"kind":"heartbeat","intervalMs":N}` while idle (default 15 s,
`createChatTransportHandler({ heartbeatMs })`, `STUDIO_HEARTBEAT_MS` here) with `Cache-Control: no-store, no-transform` and
`X-Accel-Buffering: no`, and the browser client reopens a stream that dropped or stayed silent for 2.5 intervals by itself.

The last step of `npm run studio:journey:correctness` proves it headless: it puts the studio behind `startIdleProxy` from `@hachej/boring-testing/network`, a TCP
proxy that closes any connection silent for `STUDIO_PROXY_IDLE_MS` (default 5000) like an ALB, with `STUDIO_HEARTBEAT_MS` (default 2000 in
the journey; at most half the idle timeout). An idle chat must stay connected for more than three idle timeouts without reopening its watch;
then the proxy drops every connection, the chat must read `reconnecting` and come back by itself, and a later reply must arrive exactly once.

```sh
CHROMIUM=/path/to/chromium npm run studio:journey:correctness
CHROMIUM=/path/to/chromium STUDIO_PROXY_IDLE_MS=10000 STUDIO_HEARTBEAT_MS=4000 npm run studio:journey:correctness
# By hand: the studio behind the proxy at http://127.0.0.1:4280
OPENAI_API_KEY=... STUDIO_HEARTBEAT_MS=2000 npm run studio &
node --input-type=module -e "import('@hachej/boring-testing/network').then(({ startIdleProxy }) => startIdleProxy({ target: 'http://127.0.0.1:4180', idleMs: 5000, port: 4280 }))"
```

A slow network between Enter and the host's confirmation is simulated by `STUDIO_SUBMIT_DELAY_MS` (or `startStudio({ submitDelayMs })`): the
answer to every chat submit is held that long after the host handled it. Journeys change it at run time through `app.submitFaults`
(`withSubmitFaults` from `@hachej/boring-testing/network`: `{ delayMs, refuse }`; `refuse: n` answers the next n submits with 402 `submission-refused` without reaching the conversation). Scenario
`chat-send-race` uses it with 1500 ms and 300 ms: two messages typed and sent inside the window stay two messages, and a refused one comes back.

With `STUDIO_HEARTBEAT_MS=0` (no heartbeat) the journey fails: the proxy closes the idle stream. On AWS keep the ALB idle timeout at least
twice the heartbeat (the 60 s default with the 15 s heartbeat), over HTTP/1.1 or HTTP/2 to the target.

## Two test layers

Real-model scenarios were flaky (the model answered inline instead of calling a tool, asked one question instead of two), so the browser tests run as two layers:

| Layer | Command | Model | Retries | Blocks a merge? |
| --- | --- | --- | --- | --- |
| Scripted | `npm run studio:journey:scripted` (also `npm run ambient:journey:scripted`, `npm run studio:journey:correctness`) | a scripted model, no key | none: a failure is a bug | yes: the CI job `Studio scripted journeys` ([workflow](../../.github/workflows/studio-scripted.yml)) |
| Smoke | `OPENAI_API_KEY=... npm run studio:smoke` | the real model | `STUDIO_RETRIES`, default 2 | never: exits 0 unless the pass rate is below `STUDIO_SMOKE_MIN` (default 0.6, so 3 of 5); not part of `verify`; manual [workflow](../../.github/workflows/studio-smoke.yml) |

Both need `CHROMIUM` (a Chromium or headless-shell binary) and a built tree (`npm run build`). The CI job installs the pinned headless shell
(Playwright 1.63.0, revision 1243, Chrome 153.0.8010.12) and caches it. `STUDIO_ONLY=` selects scenarios in either layer.

**Scripted layer.** The same journey, the same real browser, the same standard agent on a durable native Harness; only the model is replaced.
`scripted-model.mjs` is `createScriptedModel` from [`@hachej/boring-testing`](../../packages/testing/README.md) over the scenario and journey scripts; the
correctness journey (`correctness-fixture.mjs`) and the tests' hand-driven model (`createFakeChatModel`) use the same package, so there is one fake-model mechanism. It is chosen by the host process (`STUDIO_MODEL=scripted` or `--scripted`, or `startStudio({ scripted: true })`) and by nothing a
browser can send; the provider is named like the real one (`openai`, `gpt-5-mini`, `gpt-5-nano`) so the model picker and `configure` behave as in the real run. The
UI, the runtime, the tools and the stored data are real; what a scenario asserts about the model's output (`reply`, `nativeInputHasFile`) is checked against
what the script, which reads the native message, answered. A message no script answers fails the run at the end (and says so in the transcript). Judgement scenarios
(for example the letter review) script the mechanics only: loading skills, writing the file, delegating, reading the checklist; whether a real model does
it well is what the smoke layer and the manual real-model run are for.

**Smoke layer.** Scenarios marked `smoke: true` run against the real model, with retries, and report `smoke pass rate: n/5`: `chat-hello`, `artifact-markdown`,
`ask-picnic`, `workspace-shell`, `subagent-foreground`. A failure is printed and recorded in `smoke.json` under the evidence directory; it never fails
the build. A failure where the model did not do what the scenario answers (no `ask_user` call, too few options, no free-text field) is
reported as `model miss: ...`, distinct from a UI failure. The manual workflow needs the repository secret **`OPENAI_API_KEY`** (added by the owner in the repository settings).

### Writing a scenario script

A scenario that prompts the model has `script`: an object from a key to the model's turns. The key is a step number (`0` is the prompt of `steps[0]`) or text that
appears in the message it answers (a prompt a `verify` sends with `t.say`, a subagent's task, a background report). One *turn* is each time the runtime calls the
model: a user message starts turn 0 and every tool result starts the next.

```js
import { call } from './_script.mjs';

script: {
  0: [
    call('read', { path: 'notes.md' }),                           // turn 0: a tool call (an error result while the file is missing)
    ctx => call('write', { path: 'notes.md',                      // turn 1: decided from the result of turn 0
      content: ctx.last.isError ? '# Moon picnic\n' : `${ctx.last.text}\n- Blanket\n` }),
    'The list is saved.',                                         // turn 2: the final answer
  ],
  'Add one more bullet': [/* the answer to a message the scenario sends later */],
},
```

A turn (format owned by [`@hachej/boring-testing/model`](../../packages/testing/README.md#scripted-model-boringtestingmodel)) is a string (the final answer), `{ text, reasoning, tools: [{ name, args }], delay, hold, usage, error }`, or `ctx => turn` (`usage: { input, output }` overrides the token counts the turn reports; by default about four characters per token, priced at fictional rates). `text` can be `{ chunks, ms }` to stream slowly
(Stop and queue scenarios need a long, abortable answer: `slow(...)`, `story(seconds, ending)` in `scenarios/_script.mjs`), `delay` makes the model take a moment before it
starts (so "the agent is working" is visible) and `hold` keeps a tool call on screen, running, before the turn ends. `ctx` has `user` (the typed text), `input` (the whole
native message, including attached files and images), `results` (tool results since that message: `name`, `args`, `text`, `json`, `isError`, `details`), `last` and `history`.
Two generic rules answer mechanical prompts without a script: `Reply with exactly: X` and the "write the numbers from 1 to N in English words ... end with the exact line: X" essay.
Scenarios that begin with the same prompt share their turns (`REPORT_TURNS`, `SAVE_NOTES_TURNS` in `_script.mjs`) so the script is unambiguous. UI journeys (`journeys/*.mjs`) set
`journey.script`, and the ambient example keeps its own in `examples/ambient/script.mjs`. The loader refuses a scenario that prompts the model and has no script.

## The standard agent

Created in `server.mjs` from `defineStandardAgent` with the parts a variant's environment allows. Its system prompt is assembled from one
section per capability, so an agent without a shell is never told about bash.

| Capability | Tools | Needs |
| --- | --- | --- |
| artifacts | `present` (write the file with `write`/`edit`, then present its path); versions are the provider's history, named by save time | a workspace |
| files and the guard | Pi's `read`, `write`, `edit` through `@hachej/boring-agent/file-guard` (read before change; a stale or unread change is refused), `list_files` | a workspace |
| shared document | `notes.md`, an ordinary workspace file the agent and the person both edit | a workspace |
| canvas | `read_canvas`, `add_canvas_shapes`, `remove_canvas_shapes` on the workspace file `board.tldraw`, with the same read-before-change rule | the workspace provider |
| asking (always) | `ask_user` | none |
| skills (always) | `load_skill`; `letter-style`, `plain-language`, `letter-review` (also the `/` menu) | none |
| canvas | `read_canvas`, `add_canvas_shapes`, `remove_canvas_shapes` over one tldraw document (`board.tldraw` in the workspace) | the workspace provider |
| workspace | `read`, `list_files`, `write`, `edit` (native Pi tools over the variant's `ExecutionEnv`) | an environment |
| shell | `bash` (native Pi tool) | an environment with a shell |
| git | `working_git` | a repository over the workspace |
| subagents | `subagent` (foreground, or `background: true`), `list_subagents`, `stop_subagent` | none (children read the workspace if there is one) |
| code mode | `run_code` (upstream pi-codemode over a fictional ledger) | none |
| self-evolution | `reload` (and the person's `/reload`): the agent's own `.agent/AGENTS.md`, `.agent/skills/*.md` and `.agent/tools/<name>.json`, whose tools run through the variant's `exec` ([SELF-EVOLUTION.md](../../docs/architecture/SELF-EVOLUTION.md)) | a variant with `selfEvolving: true` (`local`) |

## Variants

`variants/*.mjs` are discovered like scenarios; the selector in the header lists all of them, and an unavailable one is disabled with its reason.

| Variant | Execution | Storage | Available |
| --- | --- | --- | --- |
| `local` (default) | just-bash virtual workspace + isomorphic-git, snapshotted to the data directory; self-evolving (agent-written tools run in just-bash) | the workspace provider's journal in the data directory | always |
| `team` | ONE agent on the studio's one harness for several fictional people: each person's workspace (just-bash over a SQLite file system) is resolved per call like the environment (`@hachej/boring-agent/workspaces`), from the person who owns the conversation (every tool takes the workspace attached to the call's env); the viewers, Git tab and `/reload` resolve it from the authenticated request; idle ones close (`STUDIO_TEAM_IDLE_MS`). Each person's workspace is a git repository (isomorphic-git over the same file system) and holds their agent's own `.agent/` (`self-evolving:team-<person>`, offered to their conversations only). The harbour MCP server is reached with each person's credential from the host's fictional vault | `team-workspaces.sqlite` (files and journal per person) | always |
| `vercel` | Vercel Sandbox microVM (Pi's `ExecutionEnv` over `@vercel/sandbox`); no virtual git | the same journal | when `VERCEL_TOKEN`, `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID` are set |
| `cloudflare` | a separate deployment, `examples/cloudflare`, running the SAME agent and scenarios on Workers | SQLite in a Durable Object | listed, not hosted here |
| `aws` | commands in an AgentCore Code Interpreter session (`@hachej/boring-execution/aws-code-interpreter`), files on the user's EFS folder mounted here and in the session; here only against the offline fake Code Interpreter behind the real AWS SDK (scenario `aws-shared-folder`). The deployable recipe is [`examples/aws`](../aws/README.md) | a directory in the data directory standing for EFS, the same journal | when `STUDIO_AWS=fake` |

Team people: the default fixture token is the studio's person (every variant, including their own team workspace); `startStudio` also mints fixture tokens for
`fictional-user-a` and `fictional-user-b` (`app.teamTokens`), who reach only the team variant, their own conversations and their own workspace. `npm run studio:journey:team`
drives two of them over HTTP with the scripted model, then in two browsers ([journey-team.mjs](journey-team.mjs); a page opened as `/#token=<fixture token>` keeps that token for the tab and takes its identity from `/api/studio`). The scenarios also run through the UI on the team variant as the studio's
person, for example `STUDIO_VARIANT=team STUDIO_ONLY=artifact-markdown,notes-document,mcp-harbour,team-letter-review,attach-text-failed-upload,mention-file npm run studio:journey:scripted`
(the canvas scenarios read the variant's single provider directly, so they stay on `local`).

Credits: a variant with `credits: true` (only `local`) meters every message with `@hachej/boring-agent/metering` ([agent README](../../packages/agent/README.md#metering)) against the person's
fictional balance in `credits.sqlite` of the data directory (a starting grant of 50 credits, a hold of 0.02 per message, Pi's `calculateCost` with a 1.25 markup). The host maps its
fixture identity to the metering scope (`userId` the person, `workspaceId` the variant, a fictional `plan` attribute). An exhausted balance refuses the next message with a notice
above the composer and the draft kept. Admission is model-aware: the scripted layer also offers a fictional `Premium` model whose messages hold 5 credits, so below that balance
choosing it is refused with the reason while the default model still answers. `GET /api/credits` returns the balance and both holds; `POST /api/credits` tops it back up to the
start (the stand-in for buying credits), or sets it to `{ balanceMicros }` (a fixture). Runs a restart interrupted are finished from Pi's state when the studio opens. The
scenario `chat-credits` drives it.

### Adding a variant

Add `variants/<name>.mjs` that default-exports `host => descriptor` (see `variants/index.mjs` for the full contract):

```js
export default host => ({
  id: 'mine', title: 'Mine', description: 'One line.',
  available: process.env.MY_KEY ? true : { reason: 'Set MY_KEY to enable it.' },
  capabilities: ['workspace', 'shell'],          // what its environment gives the agent
  async open() { return { env, root: '/work', close }; },   // env is a native Pi ExecutionEnv
});
```

Nothing else changes: the agent is built from the capabilities, the scenarios that need more are shown disabled, and the journey runs the
rest with `STUDIO_VARIANT=mine`. Files starting with `_` are helpers, not variants.

## Scenarios

The empty chat lists the scenarios grouped by topic. Click one: its files are put in the workspace, and its first prompt is sent (a mention is
put in the composer for you to send; an upload waits for you to attach the file, which the strip links to download). After the first message the
next step is suggested one tap away. A scenario the selected variant cannot run is shown disabled with the reason.

Groups: Chat basics, Ask the user, Attachments and mentions, Artifacts, Documents and files, Canvas, Workspace and shell, Git, Subagents, Code mode,
Remote sandbox, Specialised team, Self-evolution, Phone layout, Share links.

### Adding a scenario

Add `scenarios/<name>.mjs` that default-exports one scenario or an array. The loader (`scenarios/index.mjs`) documents every field:

```js
export default {
  id: 'workspace-write-file', group: 'Workspace and shell', title: 'Write a file',
  description: 'The agent writes a Markdown file; it is listed, and opens in the viewer.',
  requires: ['workspace'],                      // capabilities the variant must offer
  steps: [{ prompt: 'Create notes/todo.md with a title and three short tasks.' }],
  expect: [{ toolCalled: 'write' }, { fileExists: 'notes/todo.md' }],   // declarative checks
  async verify(t) { /* the escape hatch, for what needs custom driving */ },
};
```

The journey (`journey.mjs`) executes every applicable scenario for each selected variant exactly like a person: it clicks the scenario in the list,
types or uses the suggested next step, attaches files through the file input, answers questions, presses Stop; then it evaluates `expect`
(`journey-scenarios.mjs`) and runs `verify(t)` with the toolkit from `journey-toolkit.mjs`. The same runner executes the same files against the
Cloudflare deployment (`examples/cloudflare/journey.mjs`).

`journeys/*.mjs` are UI journeys for what is about a component rather than something the agent does: the composer and transcript mechanics
(`composer`) and the composer menus (`menus`).

## Panels

Generic only. Artifacts, the shared document and the canvas open in the `ArtifactWorkspace` right panel (resizable, full screen, a full-screen
sheet on a phone) from their cards. The **Workspace** button opens the tool view: one Files list (the files of the workspace; a document is a file at its path), and tabs only when there is
more to show: Git (variants with git, with a count of changes), Tasks (once the conversation has had subagents, with a count of running ones) and Sandbox. A file opens in the same panel in the viewer for its type.

Attachments and `@path` mentions: the server passes `createMentionResolver` (`@hachej/boring-agent/mentions`) as `prepareInput`, so the workspace file
reaches the model whether or not it has a file tool. Limits: 100 KB per file, 300 KB per message, text and images only; the rest become a short note.

Conversations: the sessions pane (left; the chat header's History pages the earlier records of the open one) is `@hachej/boring-agent/conversations` behind `/api/variants/:id/conversations` (owner: the variant's agent, read by `useConversations` of `pi-app`), so
titles, last messages, archive and delete marks live in Pi's `session.sqlite` with the transcripts. Rows offer rename, archive (an Archived
filter shows them again) and delete; a settled reply has a Fork button. Data from earlier versions (`conversations.json`,
`conversation-activity.json`) is adopted once at start and renamed to `*.migrated`.

## WhatsApp

Set these and start the studio; each allow-listed WhatsApp sender then talks to the agent in their own conversation, which also shows in the
studio's conversation list (the web chat watches it live):

```sh
WHATSAPP_ACCESS_TOKEN=…  WHATSAPP_APP_SECRET=…  WHATSAPP_VERIFY_TOKEN=<any string you choose> \
WHATSAPP_PHONE_NUMBER_ID=<business number ID>  WHATSAPP_ALLOWED=15550001,15550002  WHATSAPP_AGENT=<agent id, default standard-local> \
npm run studio
```

Expose `http://127.0.0.1:4180/api/channels/whatsapp` over HTTPS (for example `cloudflared tunnel --url http://127.0.0.1:4180`) and register `<public URL>/api/channels/whatsapp` with the verify token as the webhook of your Meta app, subscribed to `messages`. The route uses Meta's signature, not the studio bearer token. Messages from other numbers are refused without starting a run. Agent questions (`ask_user`) arrive as reply buttons or a list; a typed option, its number or free text answers them. Text only; replies after Meta's 24-hour service window are not covered.

## The three calls an application needs

```js
// Server: describe an agent, create its conversation, expose it.
const { agent } = defineStandardAgent({ model, resources, access, namespace, notes, parts });   // or defineAgent(...) directly
agent.install(registry);
const conversation = await agent.createConversation(harness, context);
const handler = createChatTransportHandler({ authenticate: async request => allowed(request) ? { conversation, context } : null });

// Browser: connect the unchanged chat controller and render the pi-chat item.
const remote = await createRemoteChat({ endpoint: '/api/chat', fetch: withCredentials });
const controller = createNativeChatController({ identity, ...remote });
<PiChat controller={controller} mode="developer" actions={{ answer: remote.answer, withdraw: remote.withdraw }} />
```

## Styles

`tailwind.mjs` compiles Tailwind v4 once at startup with the library API (theme and utilities only, no preflight, so the
viewer panels keep their own styles). It scans `registry/button`, `utils`, `pi-chat`, `pi-ambient`, `pi-workspace`, `pi-app`, `viewers` and this folder for classes, and
`themeCss()` renders the registry `theme` item (the same shadcn tokens a consumer installs) for light and dark (`prefers-color-scheme`); every example uses it. `styles.css` is the shell and panel CSS. The chat toolkit hooks
for journeys are `data-testid` attributes: `composer-input`, `composer-submit` (`data-state` is `send` or `stop`), `connection`,
`transcript`, `tool-card`, `tool-name`, `queue-item`, `question-card`, and for scenarios `scenario-list`, `scenario`, `scenario-next`.

## Limits

The real-model journey is manual evidence, not a release gate; the scripted layer blocks merges in CI but proves the UI and runtime, not the model. The transport sends the raw native view to an authenticated
viewer unless the host passes `project`; history paging returns raw entries. The local workspace is an in-memory
filesystem snapshotted to disk once a second, so a crash can lose the last second of file changes. Conversations
are not shared between browser users, and there is no identity provider. The git workspace has no remote: its
repository is only saved to the studio data directory. The remote sandbox adapter delivers command output when
the command ends and cannot cancel a running command; it has no virtual git. Scenarios share one workspace per variant within a run, so
they assert on the files they name rather than on a clean tree.
