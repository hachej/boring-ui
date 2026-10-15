# Workspace demo: an accounts-payable week

A fictional company, Harbor & Pine Foods, pays its suppliers. One person approves invoices with an agent beside the page. Everything here is invented: names, amounts, invoices and PDFs.

```
 sessions + Library  |  chat (docked)  |  the app: Approvals, Invoice, Supplier, or a Library document
```

## The story

1. The chat is docked. You ask "what needs my approval this week?" and the agent opens the Approvals queue in the viewer.
2. You open an invoice: the PDF and its extracted fields.
3. You click another invoice. The agent sees where you are (the screen context) and notices it is a duplicate of the first.
4. The agent proposes "approve it, coded to Marketing". An approval card asks you; once you approve, the app's backend saves it and returns a receipt.
5. You drag the divider. The chat floats, the sessions pane goes with it and the app takes the full width.
6. On the supplier page you ask "why is this flagged?". The agent answers in a line and does not move the page, because the chat is floating and you lead.
7. You dock the chat back. The three columns return and the conversation is intact.

Along the way: an open Library document with unsaved edits asks before you leave it, agent commands that move the viewer are addressed to one conversation and tab (a late or foreign one is dropped), and earlier conversations are listed and each keeps its transcript, and the Library opens the AP policy in the right column so the agent can answer "does this invoice respect the policy?" from the document and the invoice.

## What it shows

| Piece | Where |
| --- | --- |
| Placement (`docked` or `floating`) travels with each request and changes the agent's role, never its permissions | [PAGE-TOOLS.md](../../docs/architecture/PAGE-TOOLS.md), `renderRequestContext` in `@hachej/boring-agent/prompt-context` |
| Layout: the chat `Dock` that floats into `AmbientChat`, the sessions pane with the Library, `FileViewer` for documents | `registry/dock`, `registry/pi-app`, `page.tsx` |
| Screens as fixed experiences over registered cells (props schema, `$state` bindings, named actions, metadata) | [EXPERIENCE.md](../../docs/architecture/EXPERIENCE.md), `cells.mjs` |
| One way to change an invoice: a conditional write that names the revision that was reviewed (the agent reads it with `get_invoice` and the approval card shows it) and returns a receipt; a stale revision is refused and repeating a committed decision returns the same receipt. The buttons and the agent's `decide_invoice` tool (behind the approval card) call the same function | `ap.mjs`, `server.mjs` |

## Run it

```sh
npm ci && npm run build
npm run workspace-demo:journey      # the whole story in headless Chromium with a scripted model, no key; screenshots in .cache/evidence/workspace-demo/
npm run workspace-demo              # serves the app; with a model key (OPENAI_API_KEY) the agent is a real model
```

The journey needs a Chromium binary (`CHROMIUM=/path/to/chrome-headless-shell`, as the other journeys). The scripted model (`script.mjs`) reads the request it answers, so the journey fails if the placement or the screen stops reaching the model.

## Deploy (a plan, nothing is deployed)

- **Host recipe:** a single container on a small VM or a container service with one volume. The app is one Node process with SQLite and a data folder, and the chat is a long-lived stream, which suits a single instance. The AWS recipe (one EFS folder per user) and the Cloudflare recipe (a Durable Object) fit multi-user products; this demo has one fictional user.
- **Needs:** Node 22, `npm ci && npm run build`, a writable `APP_DATA` folder on the volume, `PORT`, and one HTTPS front (the host's own or a proxy; streaming responses must not be buffered).
- **Public safety:** the demo issues its bearer token to whoever loads the page, so a public copy runs the scripted model (`STUDIO_MODEL=scripted`, no provider key on the server) or sits behind the host's sign-in with a spend cap. The data is fictional; reset the volume on a schedule.
- **Env:** `STUDIO_MODEL=scripted` for the public copy; `OPENAI_API_KEY` only for a private copy with a real model.

## Roadmap

- "Today in AP": a fixed shell with a generated region whose candidates are these cells, composed from metadata only (`candidates()` in `cells.mjs` already lists ids, kinds and flags).
