# Workspace demo: an accounts-payable week

Harbor & Pine Foods is a fictional company with 20 invoices, seven suppliers and four expense-account budgets. Names, amounts, documents and people are invented. No payment leaves the demo.

## The flow

1. Click **Agent**. One `ArtifactWorkspace` fills the content area with its conversation and file column. The app stays mounted but hidden.
2. Ask "what needs my approval this week?" The agent's `show` tool opens Approvals in the app and floats the same conversation as `AmbientChat`.
3. Dock the agent beside the app, or click **Agent** to return to its page. The controller, transcript, composer draft and open file survive without a conversation remount.
4. Open an invoice to inspect its PDF and extracted fields. The agent can identify the duplicate, read the AP policy and propose a re-code. An approval card asks the person before the backend conditionally saves the decision and returns a receipt.
5. While floating on a supplier page, ask "why is this flagged?" The agent answers without moving the page.

The app owns its left nav: Dashboard, Approvals with a count, Invoices, Suppliers, Spend, Payments, Agent, History and Library. History uses the same `ConversationList` as the chat-header popover and `AgentWorkspace` sessions pane. Library uses the shared `FileTree`. This demo puts them only in the app nav to avoid duplicate header controls. Both pieces remain available for chat-header compositions. On a phone the ambient header has an Open navigation action.

A Library file opens in the agent's own file column, never in an app screen. While floating it replaces the visible chat in a viewport-clamped window, with a Chat back button. The conversation remains mounted underneath. Leaving an unsaved or unconfirmed document asks first. Agent commands are addressed to one conversation and tab; late or foreign commands do not navigate.

Attachments and long pastes become workspace files. Ask "create a new file tt.md and open it" to exercise native `write` and `show`. Agent writes add history with source `agent` and a change event, not a publication receipt. The open Library refreshes from that feed.

Voice is available only when the server has a transcription provider. A private run with `OPENAI_API_KEY` enables `/api/transcribe`; the scripted public demo shows no microphone.

## Composition

- `Dock` controls placement only. [The Dock guide](../../registry/README.md#docks-dock) owns its API; [PAGE-TOOLS.md](../../docs/architecture/PAGE-TOOLS.md) owns the request-context role. Page reports `docked` because the agent leads.
- One `ArtifactWorkspace` contains one `AmbientChat`, embedded for page and docked layouts. The renderer and the current file stay mounted across placement changes.
- Every app screen is a fixed Experience over registered cells with schemas, state bindings, named actions and metadata in `cells.mjs`. `finance.tsx` renders the KPI cards, searchable and filterable transaction tables, supplier cards, budget rings and savings goals. No table dependency is needed.
- The invoice buttons and the agent's `decide_invoice` tool call the same conditional backend operation in `ap.mjs`. Stale reviewed revisions are refused; repeating an accepted decision returns its receipt.
- This is host presentation and fictional app policy, not a new Pi execution mechanism. Pi retains the native Harness and tools.

## Run and verify

```sh
npm ci && npm run build
npm run workspace-demo:journey
npm run workspace-demo
```

The journey uses Chromium and a scripted model without a key. Set `CHROMIUM` to its binary. Screenshots go to `.cache/evidence/agent-page/`, including every app screen and the Agent page in light and dark at 1440×900 and 1280×720. The journey checks placement, DOM identity, draft and transcript retention, file viewing, history, approvals, uploads, live Library updates and phone layout. Search, status tabs and account chips filter the rendered invoices.

Inside the shared implementation VM, run all npm, Node and TypeScript commands through the lane's `capped` wrapper with `TMPDIR=/var/tmp`.

## Template credits

The sidebar, site header, KPI cards, transactions table, budget rings and goal-card layouts adapt [Abderrahim Ghazali's shadcn-fintech](https://github.com/abderrahimghazali/shadcn-fintech/tree/e338240d10c908ab49403adbcd0bb4cc980ebfce), pinned at `e338240d10c908ab49403adbcd0bb4cc980ebfce`, MIT, copyright 2026 Abderrahim Ghazali. The full notice is in [third-party notices](../../packages/ui/THIRD_PARTY_NOTICES.md#workspace-demo-shadcn-fintech). The port maps its Next, Base UI and Tailwind presentation to the repo's existing shadcn sidebar, input and button components. It copies no logos or avatar assets. Supplier marks are fictional initials.

## Deployment plan

Nothing is deployed. A single Node 22 process with SQLite and a writable `APP_DATA` volume fits this fictional single-user demo. Set `PORT` behind an HTTPS front that does not buffer streams. The server gives its bearer token to anyone loading the page, so a public copy must use `STUDIO_MODEL=scripted` without a provider key, or sit behind host authentication and a spend cap. Reset fictional data on a schedule.

A future "Today in AP" generated region can use the registered cell metadata from `candidates()` without exposing invoice contents to a layout evaluator. It is not implemented here.
