# Browser agent example

A Claude-Code-style coding agent that runs entirely in one browser tab. The durable native Pi Harness, its SQLite
session, the git repository, the shell and the code-mode sandbox all live in the tab. The only network traffic is
static files and model calls. All content is fictional.

## Run

```sh
npm run build
npm run browser-agent                    # http://127.0.0.1:4200; add ?scripted for the keyless demo model
CHROMIUM=/path/to/chrome-headless-shell npm run browser-agent:journey
node examples/browser-agent/serve.mjs --out .cache/browser-agent-site   # static files for any host
```

Open the model button in the chat header (the `provider-setup` registry item) and choose a provider:

- **OpenAI or Anthropic API key:** the key is saved in this browser's SQLite, and calls go straight from the tab to the provider.
- **ChatGPT subscription:** "Sign in with ChatGPT" runs pi-ai's device-code login in the tab (`openBrowserModels` registers pi-ai's OAuth flows, which a bundler cannot find on its own; nothing to do in the app). ChatGPT refuses model
  calls from web pages, so this provider needs the gateway, `<origin>/gateway` on the dev server.

The gateway is a pass-through for allow-listed provider hosts. It adds no credentials and works for any provider, so a
team proxy can replace it later without changing the agent.

A static host must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.
SQLite on OPFS and pi-codemode's interrupt buffer need cross-origin isolation.

## What runs where

| Piece | Where | How |
| --- | --- | --- |
| Pi Durable Harness, one root conversation | agent Web Worker | unchanged `pi-durable`; `SqliteStorage` over `@hachej/boring-browser/sqlite` |
| SQLite | agent worker | SQLite Wasm with the `opfs-sahpool` VFS; files `/session.sqlite` (Pi), `/app.sqlite` (settings, credentials) and `/workspace.sqlite` (the repository's files, opened with `openBrowserSqliteConnection`) |
| Models | agent worker | `@hachej/boring-browser/models`: any registered `pi-ai` provider, a SQLite `CredentialStore`, device-code sign-in; `createModelAccessHandler` serves the `provider-setup` routes (`/api/model`, `/api/model/login`) over the root conversation's native model. The gateway (`worker/gateway.js`) is this example's own host policy: a URL setting and a `fetch` wrapper for allow-listed provider hosts |
| Site API and approval | agent worker | `api_get` (free) and `api_request` (non-GET), wrapped with `requireApproval` from `@hachej/boring-agent/approval`; the person's click answers through the chat transport |
| Repository, shell, git | agent worker | `openVirtualRepository` from `@hachej/boring-execution/virtual-sqlite` (just-bash, isomorphic-git, a native `ExecutionEnv` whose shell has `git`) over the SQLite workspace backend (`openSqliteFileSystem` from `@hachej/boring-files/sqlite-filesystem`): every write is a SQLite row at once, nothing is copied or saved later; everything, including the file list, the panel and code mode, goes through that native env |
| Coding tools | agent worker | Pi's native `read`, `write`, `edit`, `bash`, plus `run_code` |
| Code mode | nested Web Worker | unchanged `pi-codemode` (QuickJS) via `@hachej/boring-browser/codemode`; read tools only (`api_get`, never `api_request`) |
| Chat UI | page | the `pi-chat` registry item over `createRemoteChat`, whose `fetch` is `connectWorker(...)` from `@hachej/boring-browser/transport`; model access is the `provider-setup` item in the chat `controls` slot |
| Preview | page | `index.html` with local CSS and JS inlined, in a sandboxed iframe without same-origin access |

Node built-ins resolve to the shims of `@hachej/boring-browser/build` at bundle time (`build.mjs`). No upstream package is forked or patched.
The page and the worker speak plain HTTP semantics, so the same page can point at a server-hosted agent by passing the
real `fetch` instead.

## The approval gate

`serve.mjs` also serves a fictional same-origin notes API (`GET`/`POST /fixture/api/notes`) and page (`/fixture/`). The agent reads it with `api_get` freely. `api_request` (POST, PUT, PATCH, DELETE) is gated: the call waits behind an Approve / Deny card showing the summary `requireApproval` stored as its headline ("Send POST /fixture/api/notes with {…}") and its real arguments collapsed under it, nothing reaches the server until the person clicks Approve, and Deny returns an error to the model. The question is stored in the conversation, so a pending approval survives a reload. `run_code` has no way to make the change: its sandbox has no `fetch` and only read tools.

## OptChat memory

The checkbox "OptChat memory" in the chat header turns [Victor Taelin's OptChat](https://gist.github.com/VictorTaelin/91837951a5ce5b38f341ec1ba1df6449) (see also [OptMem](https://github.com/VictorTaelin/OptMem)) on or off for the root conversation. It is `@hachej/boring-agent/memory/optchat`: the worker installs `memory.extension`, and the toggle calls the native `conversation.configure({ extensions: { add | remove: [memory.extension] } })` through `PUT /api/memory`, so the choice is stored in the conversation and survives a reload. It is off by default.

With it on, each request carries one message: a `<chat>` view of everything before the current message (one `id+n|text` line per node of a summary tree, coarser with age, within a byte budget) followed by the current message, plus the steps of the turn in progress. The model has `zoom(id, n)` to open a line down to the exact message and `date(id)`. The transcript in SQLite is never rewritten; turning it off sends the whole transcript again. The Memory tab shows the lines the next request would carry. Summaries are native background tasks, created after each answer and run by Pi in the worker with the model currently selected in the chat header (a cheaper model would be a better choice in a real app) and stored in the conversation. Native compaction is declined while memory is on. The package README lists the deviations from the reference (Pi transcript as the log, current turn verbatim, summarizer usage is in `pi.usage`, no cache breakpoints).

## Journey

`journey.mjs` drives the real page with the scripted model. The agent writes a todo app with Pi's `write` tool, checks
it with `bash`, measures it with `run_code` and commits it with `git`. The journey then checks:

- the preview and the git log;
- that the server received no request other than static files;
- that a reload restores the conversation and the repository from SQLite;
- that reading the fixture API shows no approval card; that a POST shows one and the server sees nothing until the click; that Deny leaves the data unchanged and the model is told; that Approve creates the note (checked with a GET); that a pending approval is still there, and still answerable, after a page reload; and that `run_code` cannot make the change;
- that OptChat memory is off by default and the header toggle turns it on; that a request then holds one message (the view plus the current one) and no earlier turn, yet the model recalls a dog's name told two turns before from the view; that the model zooms a view line down to the exact original message; and that after a reload (still on) switching it off sends the plain transcript, tool steps included, again;
- that a second tab of the same profile gets the readable one-tab message (`BrowserSqliteLockedError`, carried over the worker boundary) and the first tab keeps working;
- that a changed file, a deleted file and an empty folder are back after a reload, read from the SQLite rows (`openVirtualRepository` over `openSqliteFileSystem`);
- that saving an API key in the model popover selects that provider, and that the gateway refuses other hosts;
- that "Sign in with ChatGPT" runs pi-ai's bundled device-code flow in the worker and shows the code. The journey sends OpenAI's sign-in endpoints to a local stand-in on the dev server, so it never contacts a production service; no login is completed.

Screenshots and `journey.json` go to `.cache/evidence/browser-agent`.

## Limits

- **Not yet tested with a live model:** the API-key and ChatGPT paths have not made a model call, and a real ChatGPT sign-in has only been tried by hand. The journey uses scripted models and a local sign-in stand-in by design (no production services in tests).
- **Storage is per browser profile and origin.** "Reset everything" deletes it. Keys are stored unencrypted, like any browser app's local data.
- **The shell has no network or package managers.** just-bash has no `node`, `npm`, `python` or network; `gzip` is unavailable.
  git is the small subset in `@hachej/boring-execution/virtual-git`.
- **One tab at a time.** The `opfs-sahpool` VFS lets only one tab hold the database. A second tab shows "already open in another tab" with a retry button instead of starting a second agent.
- **Bundles are readable by default** (the agent worker is about 5.7 MB); `serve.mjs --out` minifies them (about 2.9 MB) with `browserBundleOptions(side, { minify: true })`.
