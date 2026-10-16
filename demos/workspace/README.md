# Workspace demo: an accounts-payable week

Harbor & Pine Foods is a fictional company with 20 invoices, seven suppliers and four expense-account budgets. Names, amounts, documents and people are invented. No payment leaves the demo.

## The flow

1. Click **Agent**. One `ArtifactWorkspace` fills the content area with its conversation and file column. The app stays mounted but hidden.
2. Ask "what needs my approval this week?" The agent's `show` tool opens Approvals in the app and floats the same conversation as `AmbientChat`.
3. Dock the agent beside the app, or click **Agent** to return to its page. The controller, transcript, composer draft and open file survive without a conversation remount.
4. Open an invoice to inspect its PDF and extracted fields. The agent can identify the duplicate, read the AP policy and propose a re-code. An approval card asks the person before the backend conditionally saves the decision and returns a receipt.
5. While floating on a supplier page, ask "why is this flagged?" The agent answers without moving the page.

The app's left nav contains Dashboard, Approvals with a count, Invoices, Suppliers, Spend, Payments and Agent. History and Library are icons in the chat top bar in page, docked and floating layouts. Their Base UI popovers anchor to the icons and flip above a collapsed floating bar. History uses the shared `ConversationList`; Library uses the shared `FileTree`. Escape restores focus to the icon. On a phone the ambient header also has an Open navigation action.

The window-shaped button was `Float agent`, using `PanelTopIcon`. It is removed. Selecting an app entry floats the agent and shows that screen. The divider still floats on drag or Alt+Left, the Agent entry restores the page, and the existing Dock controls return it beside the app.

A Library file opens in the agent's own file column, never in an app screen. While floating it replaces the visible chat in a viewport-clamped window, with a Chat back button. The conversation remains mounted underneath. Leaving an unsaved or unconfirmed document asks first. Agent commands are addressed to one conversation and tab; late or foreign commands do not navigate.

Attachments and long pastes become workspace files. Ask "create a new file tt.md and open it" to exercise native `write` and `show`. Agent writes add history with source `agent` and a change event, not a publication receipt. The open Library refreshes from that feed.

Voice is available only when the server has a transcription provider. A private run with `OPENAI_API_KEY` enables `/api/transcribe`; the scripted public demo shows no microphone.

## Composition

- `Dock` controls placement only. [The Dock guide](../../registry/README.md#docks-dock) owns its API; [PAGE-TOOLS.md](../../docs/architecture/PAGE-TOOLS.md) owns the request-context role. Page reports `docked` because the agent leads.
- One `ArtifactWorkspace` contains one `AmbientChat`, embedded for page and docked layouts. The renderer and the current file stay mounted across placement changes.
- Every app screen is a fixed Experience over registered cells with schemas, state bindings, named actions and metadata in `cells.mjs`. `finance.tsx` renders flat metrics, searchable invoice and approval tables, the supplier directory and budget progress. No table dependency is needed.
- `AmbientChat.headerTools` supplies the floating top-bar popovers. The embedded header uses the same `ChatTools` component.
- The shared compact viewer header keeps Back, the file title, editing controls, and overflow in one row inside the inset card. Metadata appears on hover. Phone editing controls move into overflow; the file covers the chat without replacing its mount. Library and History use bottom drawers on phones.
- The invoice buttons and the agent's `decide_invoice` tool call the same conditional backend operation in `ap.mjs`. Stale reviewed revisions are refused; repeating an accepted decision returns its receipt.
- This is host presentation and fictional app policy, not a new Pi execution mechanism. Pi retains the native Harness and tools.

## Run and verify

```sh
npm ci && npm run build
npm run workspace-demo:journey
npm run workspace-demo
```

The journey uses Chromium and a scripted model without a key. Set `CHROMIUM` to its binary. Screenshots go to `.cache/evidence/saas-v2/`, including every app screen and the Agent page in light and dark at 1440×900, 1280×720 and 390×844. The journey checks placement, DOM identity, draft and transcript retention, file viewing, history, approvals, uploads, live Library updates and phone layout. Search, status tabs and account chips filter the rendered invoices.

Inside the shared implementation VM, run all npm, Node and TypeScript commands through the lane's `capped` wrapper with `TMPDIR=/var/tmp`.

## Template credits

The app presentation adapts [Tremor Planner](https://github.com/tremorlabs/template-planner/tree/7b5d1f10e2705c9a2dca108c41910793185cdbb8), pinned at `7b5d1f10e2705c9a2dca108c41910793185cdbb8`. Its `LICENSE.md` is MIT, copyright 2025 Tremor Labs, Inc. Its README still links the commercial Tremor licence; this port uses the repository's explicit MIT notice, reproduced in [third-party notices](../../packages/ui/THIRD_PARTY_NOTICES.md#workspace-demo-tremor-planner).

The adaptation uses Planner's sidebar, breadcrumbs, table-first layout, flat metrics, status badges and progress rows over this repo's existing Base UI shadcn sidebar, input and button components. It copies no logos, fonts, customer data, avatar assets or Next runtime. Supplier marks are fictional initials. The former shadcn-fintech presentation and notice are removed.

Live candidate screenshots are under `.cache/evidence/saas-v2/candidates/`: `studio-finance.png`, `studio-invoices.png`, `tremor-insights.png`, `tremor-dashboard.png`, `tremor-planner.png`, `shadcn-dashboard-01.png` and `shadcn-sidebar-07.png`. Planner's compact metrics and flat operational tables fit daily AP review without the finance dashboard's dense card grid or the sidebar block's placeholder content. The clone was inspected read-only; no template scripts were run.

## Deployment plan

Nothing is deployed. A single Node 22 process with SQLite and a writable `APP_DATA` volume fits this fictional single-user demo. Set `PORT` behind an HTTPS front that does not buffer streams. The server gives its bearer token to anyone loading the page, so a public copy must use `STUDIO_MODEL=scripted` without a provider key, or sit behind host authentication and a spend cap. Reset fictional data on a schedule.

A future "Today in AP" generated region can use the registered cell metadata from `candidates()` without exposing invoice contents to a layout evaluator. It is not implemented here.
