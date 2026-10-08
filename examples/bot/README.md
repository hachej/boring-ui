# Bot example

A personal-assistant chatbot (in the spirit of Instinct) as one lifelong conversation on the durable native Pi Harness.
It combines three ideas: OptChat memory (`@hachej/boring-agent/memory/optchat`), code mode, and a self it can edit and redeploy
while the conversation keeps running. Everything is built from public Pi seams; all content is fictional.

## Run

```sh
npm run build
OPENAI_API_KEY=... npm run bot                     # http://127.0.0.1:4192, data in .cache/bot (BOT_DATA)
BOT_PROVIDER=anthropic ANTHROPIC_API_KEY=... npm run bot
CHROMIUM=/path/to/chrome-headless-shell npm run bot:journey                              # scripted model, no key
CHROMIUM=... OPENAI_API_KEY=... BOT_JOURNEY=live npm run bot:journey                     # a real model
```

`BOT_MODEL` and `BOT_NAP_MODEL` override the chat model (default `gpt-5-mini`) and the summarizer (default `gpt-5-nano`).
The journey writes screenshots and `journey.json` to `.cache/evidence/bot`.

## How it works

| Piece | File | Native seam |
| --- | --- | --- |
| One conversation for life | `server.mjs` | `harness.root()` over SQLite storage; reopening resumes it |
| OptChat memory | `agent.mjs` (`createOptChatMemory`) | native extension, opted in with `conversation.configure({ extensions: { add } })`; `beforeRequest` replaces one request's messages, the stored log is untouched |
| Summaries | the package | `onYield` and the next request start the compactor; nodes are a conversation document family with fingerprints |
| zoom / date | the package | native tools; `zoom` is also a host tool inside `run_code` |
| No native compaction | the package | `CompactionTask.beforeCompact` declines while the extension is selected |
| Code mode | `self.mjs` | `run_code` over upstream `pi-codemode` (QuickJS) |
| Redeploy | `agent.mjs`, `self.mjs` | `registry.install()` of a same-named extension (`bot.self`) |

## OptChat memory

This is [Victor Taelin's OptChat](https://gist.github.com/VictorTaelin/91837951a5ce5b38f341ec1ba1df6449) (and his
[OptMem](https://github.com/VictorTaelin/OptMem)) on a native Pi conversation; the package README has the full mapping and
every deviation. In short: the Pi transcript is the append-only log. Each request shows the model one `<chat>` view of
everything said before the current message, one `id+n|text` line per node of a binary summary tree (short messages stay
word for word, older ones are merged into coarser lines under a byte budget, the start of the view stays stable), then the
current message and the steps of the turn in progress verbatim. `zoom(id, n)` opens a line into the two it was made from,
down to the message; `date(id)` gives its time. After each answer the summarizer (`BOT_NAP_MODEL`) makes the missing
summaries as native background tasks, so the next request finds its view ready and waits only if it is not. Pi's positional system messages (persona,
tools) are always kept, and native compaction is declined while memory is on.

The bot is the always-on case: `server.mjs` opts its one conversation in with `configure`, and `startBot({ memory })` takes
the package options (the journey sets a small `viewBytes` so ten facts fold into coarser lines). Unlike the reference, the
bot has no regex `recall`; the view and `zoom` are the only way back. The `/api/bot/nap` route runs the summarizer to
completion.

Deviations from the reference, short list: the log is Pi's context rather than an OptChat file; the current turn is
verbatim instead of one line per step; summaries are native background tasks and their usage is in `stats()`, not `pi.usage` (no public seam); no provider cache breakpoints, subagent or
note kinds.

**Self.** `/workspace/self/persona.md` becomes a prompt section. `abilities/<name>.js` is an async function body
(`// description:` and `// args:` header lines) callable as `abilities.<name>()` inside `run_code`. The bot edits these
files with the native read/write/edit tools, then calls `redeploy`. The host checks every ability compiles in the
sandbox and installs the new self. Pi resolves extensions per request, so the same run continues under the new
version. Deploys are recorded by the host in `deploys.json`, outside anything the bot can write, and the panel rolls
back to any version, restoring its files.

Generated content never becomes native code: the persona is prompt text and abilities run only in the sandbox, whose
host tools are `today`, `recall`, `zoom` and file access limited to `/workspace/self`.

## Limits

This is a proof of concept. Summarizer calls are not counted in `pi.usage`, and message ids assume the context is never
reset (a reset or edit invalidates the summaries it touches; the view is rebuilt). The workspace is an in-memory filesystem saved once a second, so a crash can lose the last second
of file changes. There is no identity provider; the bearer token is a per-process fixture. The live journey checks
behaviour loosely because a real model's wording varies.
