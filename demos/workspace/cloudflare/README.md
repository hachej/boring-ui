# Public workspace demo on a Cloudflare Worker

The [workspace demo](../README.md) (Harbor & Pine's accounts-payable week: chat, artifacts, Library, History column, the full design) as a public page at `https://demo.senecaapp.ai`, for anonymous visitors. Scripted model: no provider key, no spend. Fictional data only.

It is the same demo as `npm run workspace-demo`, not a copy: the agent, its tools, the Library seed, the seeded conversations and the routes are `../app.mjs`; the page, bundle, stylesheet, pdf.js worker and brand theme are `../assets.mjs`; the backend is `../ap.mjs`; the scripted turns are `../script.mjs`. Only the host differs, and it follows [examples/hosts/cloudflare](../../../examples/hosts/cloudflare/README.md).

| Need | Where it runs |
|---|---|
| Agent loop, transcripts, recovery | Native Pi Durable on `PiHarness` (`agents/harness/pi`) in a SQLite-backed Durable Object (`DemoSession`); submissions go through `PiHarness` so a running turn keeps a wake job |
| Visitor isolation | One object per visitor session: `src/worker.mjs` reads the `demo_session` cookie (32 hex characters) and forwards to `SESSIONS.getByName(session)`. Nothing is shared between objects |
| Files | The Library and the invoice records are two workspaces in the object's own SQLite (`openSqliteFileSystem` + one `createWorkspaceProvider` each, journal in the same database); Pi's file tools run over Pi's environment from `createVirtualWorkspace` on the same rows |
| Model | `scriptedModels()` from `../app.mjs` (the studio's scripted provider answering from `../script.mjs`), the same as `STUDIO_MODEL=scripted` on the Node server |
| Browser | `public/` (Workers static assets), written by `build.mjs` from `../assets.mjs`. `index.html` loads `/api/session.js`, which the Worker answers with `window.__APP__` for the visitor's own session (the Node server inlines the same object) |

## Limits

Abuse limits, all in `src/worker.mjs` (`LIMITS`):

- **Sessions.** A session starts only from the page's bootstrap (`GET /api/session.js`); every other `/api/*` call without a valid session cookie gets 401 before any object is woken. The cookie is `HttpOnly; SameSite=Strict` (plus `Secure` on HTTPS) and is the only credential: the page gets no bearer token (`token: null`). New sessions are limited to 20 a minute per client IP (Workers rate limiting binding `NEW_SESSIONS`).
- **Expiry.** A session's data (files, invoices, transcripts, Pi's tables, counters) is deleted by a Durable Object alarm (a Lifecycle job) 2 hours after its last request, and at the latest 8 hours after it was created, even with a tab left open. The object then drops its in-memory instance; the next visit with the same cookie starts from fresh fixtures.
- **Body size.** The Worker refuses a request body over 1 MiB (413) and a body without `Content-Length` (411) before forwarding it.
- **Rate limits (per session).** 30 chat messages and 120 other writes (uploads, saves, decisions, new conversations) per 10 minutes, then 429 with `Retry-After`. 20 MiB of request bodies in total per session, then 413. Reads are not limited: the open page polls its state.
- **No outbound reach.** No provider key, no Workers AI, no transcription or microphone route (`/api/transcribe` is 401/404), no debug routes. The agent's tools are the demo's own (`pending_approvals`, `get_invoice`, `show`, `decide_invoice` behind the approval card) and Pi's `read`, `write`, `edit` and `list_files` over the session's own SQLite files; there is no bash tool and nothing that opens a network connection.
- **Data.** Fictional fixtures only. Whatever a visitor types or uploads stays in their own object and is deleted with it.

For a local proof run the numbers are vars (`DEMO_IDLE_MS`, `DEMO_MAX_AGE_MS`, `DEMO_MAX_BODY_BYTES`, `DEMO_MESSAGE_LIMIT`, `DEMO_WRITE_LIMIT`, `DEMO_WINDOW_MS`, `DEMO_BUDGET_BYTES`); a deployment sets none of them.

## Run locally and verify

Inside the shared implementation VM, run these through the lane's `capped` wrapper with `TMPDIR=/var/tmp`.

```sh
npm ci
npm run workspace-demo:cloudflare:build        # packages, then the page into demos/workspace/cloudflare/public (gitignored)
npm run workspace-demo:cloudflare:dev          # wrangler dev --local, http://localhost:8787
CHROMIUM=<chromium binary> npm run workspace-demo:cloudflare:journey
```

The journey starts its own `wrangler dev --local` on a free port (or uses `DEMO_URL=<url>` for a running Worker) and checks: the static files (pdf.js worker, brand theme) and the 401 session gate; two sessions never see each other's files or invoice decisions; a 2 MiB body is 413 and an unsized one 411; the 31st message in the window is 429 for that session only; the accounts-payable flow in Chromium (approvals queue, invoice PDF drawn by pdf.js, duplicate, policy from the Library, approve-and-recode with a receipt, attachment, agent-written file), then reload with `?theme=brand` and phone width. With its own Worker it also restarts it with `DEMO_IDLE_MS=3000` and checks that an idle session's files are deleted and the same cookie gets fresh fixtures. Screenshots (desktop 1440 and phone 390, light and dark, stock and brand) go to `.cache/evidence/demo-worker/`.

## Deploy

Not deployed by this change. With `CLOUDFLARE_API_TOKEN` (Workers Scripts, Durable Objects, Workers Routes and DNS edit on the `senecaapp.ai` zone) and `CLOUDFLARE_ACCOUNT_ID` in the environment:

```sh
npm ci
npm run workspace-demo:cloudflare:build
npx wrangler deploy --config demos/workspace/cloudflare/wrangler.jsonc
```

`wrangler.jsonc` names the Worker `boring-ui-demo` and declares `demo.senecaapp.ai` as a custom domain (`routes: [{ pattern: "demo.senecaapp.ai", custom_domain: true }]`): the deploy creates the DNS record and certificate on the `senecaapp.ai` zone. `workers_dev` is off, so the demo has no `*.workers.dev` address. No secret is needed. Check afterwards with `DEMO_URL=https://demo.senecaapp.ai CHROMIUM=<binary> npm run workspace-demo:cloudflare:journey` (it skips the expiry proof against a deployment).

Dry run (no account needed; CI runs it): `npx wrangler deploy --dry-run --outdir /var/tmp/demo-worker-dry --config demos/workspace/cloudflare/wrangler.jsonc`.

Delete: `npx wrangler delete --config demos/workspace/cloudflare/wrangler.jsonc` (removes the Worker, its custom domain and every session's data).
