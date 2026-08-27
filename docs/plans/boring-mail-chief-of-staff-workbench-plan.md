# Boring Mail — Agent-Native Chief-of-Staff Workbench Plan

## Status

- Plan state: `ready-for-agent` for Slice 1 only.
- Target project/repo: future public `hachej/boring-mail` project.
- Planning source: product conversation on 2026-07-23.
- Boring UI dependency: reuse existing workspace plugin surfaces and existing Inbox/ask-user attention surface; do not rebuild attention in boring-mail v1.
- Adversarial review: completed; accepted findings incorporated below.

## Problem Statement

`boring-mail` should not be a normal email client with AI bolted on. The product is an agent-native Chief of Staff for communication streams:

- agents read communication first;
- the human sees only curated attention points in the existing Boring UI Inbox/ask-user surface;
- the user can still inspect the raw source communication when needed;
- each raw email/thread is an artifact-like workbench target that agents and attention items can open on demand.

The first implementation should focus on the missing raw communication workbench, not on rebuilding the attention inbox.

## Solution

Build `boring-mail` as a regular Node/React app with internal plugin boundaries from day one, plus a Boring UI adapter/plugin surface.

In Boring UI, `boring-mail` v1 contributes:

1. a `workspaceSource` left-pane Mail source, equivalent to the filetree pattern;
2. a shared Dockview email/thread panel;
3. a surface resolver so agents/attention items can open a stable email/thread artifact target;
4. SQLite-backed routes for raw messages, threads, tags, saved views, and search.

The existing Inbox/ask-user plugin remains the human attention surface. A later automation loop periodically syncs email, curates it with an agent, and creates/updates existing Inbox attention points that link back to `boring-mail` email/thread tabs.

## User Stories / Scenarios

### Scenario: human browses raw communication

A user opens the Mail workspace source, searches or filters by a saved inbox/tag, selects a raw email/thread, and gets one stable Dockview tab for that thread.

### Scenario: agent references a raw email artifact

An agent finds a relevant email/thread and emits an opaque `boring-mail.thread` target. Boring UI resolves that target and opens/focuses the same thread tab without exposing raw email addresses, subjects, or provider ids in the target.

### Scenario: attention item opens source context

The existing Inbox/ask-user attention surface shows a human attention point. That attention item must contain an artifact/source link to the raw email/thread. When the user opens the artifact link, Boring UI opens/focuses the corresponding `boring-mail.thread` tab so the user can inspect the raw source.

### Scenario: Chief-of-Staff automation, later

A scheduled job syncs new messages, curates them, and creates/updates existing Inbox attention items only after a stable attention projection contract exists. The raw mail workbench remains usable without this automation.

## Target UX

### Locked workbench behavior

```txt
Workbench source icon: Mail
Workbench-left source pane: raw mail list + compact filters
Shared Dockview: one email/thread tab per opened email/thread
Existing Inbox: attention points, ask-user, approvals, agent pings
```

### Mail source pane

Do not recreate Gmail's permanent label sidebar. The Gmail sidebar has low value inside Boring because Boring already has app-left/workbench source chrome.

The Mail source pane should contain:

```txt
Search
View dropdown: Inbox / All / Sent / Starred / Snoozed / Trash / saved views
Tag chips or tag filter popover
Thread/email list
```

Clicking an email/thread opens or focuses a stable Dockview tab through supported workspace APIs only: `WorkspaceSourceProps.openPanel` or an `openSurface`/surface resolver path. Source panes must not reach into private Dockview internals.

### Email/thread tab

Rule:

```txt
1 email/thread = 1 Dockview tab
```

Email/thread tabs are artifact-like. Agents and Inbox attention items should be able to open them through a stable opaque ref.

## Boring UI Plugin Shape

Front plugin shape:

```ts
definePlugin({
  id: "boring-mail",
  label: "Mail",
  workspaceSources: [
    {
      id: "boring-mail.source",
      label: "Mail",
      icon: Mail,
      component: MailSourcePane,
      source: "app",
    },
  ],
  panels: [
    {
      id: "boring-mail.thread",
      label: "Email",
      placement: "shared-dockview",
      component: MailThreadPanel,
      source: "app",
    },
  ],
  surfaceResolvers: [
    {
      id: "boring-mail.open-thread",
      kind: "boring-mail.thread",
      resolve: ({ target }) => ({
        id: `boring-mail.thread.${target}`,
        component: "boring-mail.thread",
        title: "Email",
        params: { threadId: target },
      }),
    },
  ],
})
```

Important: `target` must be an opaque local id, never a raw subject, email address, provider message id, or Gmail thread id.

## Repository Shape

Use a regular app structure, not a monorepo-heavy platform shape:

```txt
boring-mail/
  package.json
  src/
    client/
      App.tsx
      main.tsx

    server/
      index.ts
      routes.ts

    shared/
      types.ts
      schema.ts

    mail/
      plugin.ts
      client/
      server/
      shared/

    plugin-host/
      definePlugin.ts
      registry.ts

    storage/
      sqlite.ts
      migrations/

    boring-ui/
      front.tsx
      server.ts
```

The standalone app and Boring UI adapter consume the same internal mail plugin contract.

## Decisions

### Existing Inbox owns attention

- `boring-mail` does not rebuild an attention surface.
- Current Boring UI Inbox/ask-user remains the human attention channel.
- `boring-mail` owns raw communication archive/explorer and source artifacts.

### Email/thread is an artifact-like target

- Every raw thread/message gets an opaque stable local id.
- Attention items and agents refer to those ids.
- The Boring UI adapter maps them to `boring-mail.thread` surface/panel openings.

### SQLite first

- Slice 1 may use fixtures as a tracer bullet only.
- V1 complete requires SQLite-backed raw mail state.
- Attachments/raw MIME can live as filesystem blobs referenced from SQLite.
- Postgres is out of scope for v1.
- Parquet/DuckDB/msgvault-style analytics are future derived caches, not the v1 source of truth.

### Read-only first

- V1 is a raw explorer/archive and artifact opener.
- Sending/replying, provider label mutation, delete, and OAuth write scopes are out of scope for the first slices.

### Attention bridge is projection, not ask-user internals

Automation may create existing Inbox attention points, but the plan must not import ask-user front internals. The accepted path is a Boring UI adapter/provider that projects plugin-owned backend attention state into supported workspace attention/blocker APIs, or uses stable ask-user/Inbox bridge/routes if/when available.

## Data Model

Minimum SQLite entities for v1:

```txt
mail_accounts
  id                 opaque local account id
  provider           gmail | imap | fixture | later slack/agent
  external_account_id
  display_name
  email
  created_at
  updated_at

mail_threads
  id                 opaque local thread id
  account_id
  provider
  provider_thread_id encrypted/hashed or stored only when needed
  subject
  snippet
  mailbox            inbox | sent | trash | archive | custom
  unread
  starred
  archived
  last_message_at
  created_at
  updated_at
  UNIQUE(account_id, provider, provider_thread_id)

mail_messages
  id                 opaque local message id
  thread_id
  account_id
  provider
  provider_message_id
  direction          inbound | outbound
  from_json
  to_json
  cc_json
  bcc_json
  subject
  body_text
  body_html_sanitized
  raw_mime_blob_id nullable
  sent_at
  received_at
  created_at
  updated_at
  UNIQUE(account_id, provider, provider_message_id)

mail_attachments
  id
  message_id
  filename
  media_type
  byte_size
  content_hash
  blob_id
  created_at

mail_tags
  id
  name
  color nullable
  created_at

mail_thread_tags
  thread_id
  tag_id
  source             user | agent | provider
  created_at
  PRIMARY KEY(thread_id, tag_id)

mail_saved_views
  id
  name
  filter_json
  sort_json
  created_at
  updated_at

mail_sync_state
  account_id
  provider
  cursor             provider history id / IMAP uidvalidity+uidnext / fixture cursor
  last_synced_at
  last_error

mail_attention_links
  id
  thread_id
  message_id nullable
  inbox_item_id nullable
  idempotency_key
  status             proposed | active | resolved | dismissed
  created_at
  updated_at
  UNIQUE(idempotency_key)
```

Search v1 can start with SQLite FTS over normalized subject/from/body/snippet. Raw MIME retention should be optional/configured.

## Automation Loop

Future loop:

```txt
Every X minutes:
  1. sync/read new emails
  2. upsert raw threads/messages/attachments into SQLite
  3. run Chief-of-Staff curation agent over new/changed items
  4. create/update existing Inbox attention points
  5. attach artifact target back to boring-mail thread tab
```

Each attention item created from mail must carry an artifact ref/link to the raw email/thread. This is the canonical bridge from the Chief-of-Staff attention queue back to source evidence.

Attention artifact target shape:

```ts
{
  type: "surface",
  surfaceKind: "boring-mail.thread",
  target: "thread_opaque_id"
}
```

or panel form when needed:

```ts
{
  type: "panel",
  panelComponentId: "boring-mail.thread",
  params: { threadId: "thread_opaque_id" }
}
```

## Security / Privacy Gates

Before real Gmail/IMAP OAuth sync ships:

- define OAuth scopes and read-only-first consent copy;
- encrypt or OS-keychain-store provider tokens;
- sanitize HTML email before rendering;
- block active content and remote tracking pixels by default;
- treat attachments as untrusted blobs;
- define whether agents may read full message bodies by default;
- add deletion/export story for the local SQLite/blob store;
- avoid PII in panel ids, surface targets, logs, and route paths.

## Flag / Abstraction

- Needed?: Yes, for Boring UI integration and automation.
- Path:
  - `boring-mail` package exposes standalone app and `src/boring-ui/front.tsx` / `src/boring-ui/server.ts` adapter entries.
  - Boring UI loads it as a normal boot-time package plugin when integrated.
  - Automation disabled by default until explicit config exists.
- Rollback:
  - Remove plugin from Boring UI default package composition.
  - SQLite store remains local and inert.
  - Existing Inbox/ask-user behavior is unchanged.

## Test Seams

- Highest public seam:
  - Boring UI front plugin captures `workspaceSources`, `panels`, and `surfaceResolvers`.
  - HTTP routes return fixture/SQLite threads and messages.
  - Surface resolver opens stable thread panel ids.
- Existing prior art:
  - `plugins/data-catalog` uses `workspaceSources` for left-pane data exploration.
  - `plugins/ask-user` owns current Inbox/attention UI.
  - Boring workspace shell supports shared Dockview panels and surface resolvers.
- Avoid testing:
  - Gmail OAuth/network in early slices.
  - Pixel-perfect Gmail clone behavior.
  - Full curation quality before raw artifact loop exists.

## Acceptance

### Slice 1 tracer-bullet acceptance

- Mail source appears in the workbench left source rail.
- Source pane shows searchable/filterable fixture-backed thread list.
- Selecting a fixture thread opens a stable shared Dockview tab through `openPanel` or the surface resolver.
- Re-selecting the same thread focuses/reuses the same tab, not duplicate tabs.
- Thread tab renders fixture body and attachment metadata.
- Surface resolver can open the same thread from an opaque target id.
- Existing Inbox plugin remains untouched for attention.

### V1 complete acceptance

- Slice 1 tracer-bullet behavior remains intact.
- Source pane reads SQLite-backed routes, not hard-coded fixtures.
- SQLite migrations create the raw mail schema.
- Manual/fixture importer can seed accounts, threads, messages, attachments, tags, and saved views.
- SQLite FTS/search works across subject, sender, snippet, and normalized body.
- Thread/message ids are opaque local ids with no PII in route paths, panel ids, logs, or surface targets.
- Sanitized HTML/body rendering and attachment metadata are used in the thread tab.

## Proof

- Exact command:
  - Slice 1 target: `pnpm test -- --run boring-mail-plugin` or equivalent once tests exist.
  - Slice 2 target: `pnpm test -- --run boring-mail-storage boring-mail-routes` or equivalent once tests exist.
  - Boring UI adapter tests must prove `workspaceSources`, `panels`, and `surfaceResolvers` registration.
- Screenshot/demo:
  - Workbench with Mail source pane open and one or more email tabs in Dockview.
- Manual steps:
  1. Open Boring UI workspace with boring-mail plugin installed.
  2. Click Mail workspace source icon.
  3. Search/filter list.
  4. Click a thread.
  5. Verify tab opens/focuses.
  6. Trigger open-surface for same opaque thread id and verify same tab focuses.
- Waiver:
  - Real Gmail sync and automation proof waived until later slices.

## Slices

### Slice 1: Fixture-backed workbench plugin

**Delivers:**
- Regular `boring-mail` app skeleton.
- Internal mail plugin contract.
- Boring UI front adapter with `workspaceSource`, `boring-mail.thread` panel, and surface resolver.
- Fixture-backed thread list and thread tab.

**Blocked by:** None.

**Proof:**
- Exact command target: `pnpm test -- --run boring-mail-plugin`.
- Test seam: capture the front plugin and assert one `workspaceSource`, one `boring-mail.thread` panel, and one `boring-mail.thread` surface resolver.
- Manual demo/screenshot: Mail source visible; selecting fixture thread opens/focuses a shared Dockview tab.

**Review budget:** inside.

### Slice 2: SQLite raw store and routes

**Delivers:**
- SQLite schema/migrations for accounts, threads, messages, attachments, tags, saved views.
- HTTP routes for listing/searching/opening threads.
- Fixture importer seeds SQLite.
- Source pane reads backend, not static fixtures.

**Blocked by:** Slice 1.

**Proof:**
- Exact command target: `pnpm test -- --run boring-mail-storage boring-mail-routes`.
- Migration test asserts all v1 tables/indexes/FTS exist.
- Route tests seed SQLite and verify list/search/thread detail responses use opaque ids.
- UI smoke/manual demo against seeded SQLite.

**Review budget:** inside.

### Slice 3: Read-only provider sync

**Delivers:**
- One read-only source: choose Gmail or IMAP after OAuth/security decision.
- Idempotent upsert using account/provider ids and sync cursor.
- No send/reply/delete/provider label mutation.

**Blocked by:** Slice 2 and OAuth/privacy decision.

**Proof:**
- Exact command target: `pnpm test -- --run boring-mail-provider-sync`.
- Provider fake/e2e runs the same sync twice and proves no duplicate threads/messages.
- Manual sync against test mailbox if credentials are available; otherwise waiver records missing credentials.

**Review budget:** may exceed because OAuth/security review required.

### Slice 4: Attention projection automation

**Delivers:**
- Background/scheduled curation job behind explicit config.
- Creates or updates existing Inbox attention items with links back to `boring-mail.thread` targets.
- Idempotency through `mail_attention_links`.

**Blocked by:** Slice 2, and stable Boring UI/ask-user attention projection contract.

**Proof:**
- Exact command target: `pnpm test -- --run boring-mail-attention-projection`.
- Fixture messages -> curation stub -> projected Inbox item containing a `boring-mail.thread` artifact link -> click/open artifact opens thread tab.
- Manual demo required before enabling real scheduled automation.

**Review budget:** exceeds; requires product/security review.

## Wide Refactor Strategy

Not applicable for v1. This is greenfield. If current Inbox APIs need extension for plugin-owned durable attention projections, use expand → migrate → contract:

1. expand: add generic attention projection API without changing ask-user behavior;
2. migrate: have boring-mail use it;
3. contract: remove any temporary direct coupling.

## Out of Scope

- Rebuilding the existing Inbox/ask-user attention UI.
- Permanent Gmail-style label sidebar.
- Sending/replying/composing mail.
- Provider-side label/archive/delete mutation.
- Slack/Discord/GitHub sources.
- Parquet/DuckDB analytics cache.
- msgvault sidecar integration.
- Hosted multi-tenant Postgres storage.

## Open Questions

1. Where should v1 SQLite live in Boring UI mode: workspace-local `.boring-mail/`, agent-box-local, or user-global? Current default recommendation: configurable, workspace-local for v1.
2. Which read-only provider should Slice 3 target first: Gmail OAuth or IMAP?
3. What exact existing Inbox/attention projection API should boring-mail use without importing ask-user internals?
4. What is the default agent-read policy for private email bodies?
5. Should raw MIME be retained by default, or only normalized sanitized body + attachments?

## Adversarial Review Result

Accepted findings:

- Current Inbox attention state is not automatically backend-durable; plan now requires an explicit Boring UI adapter/projection path instead of pretending backend automation can directly write the front Inbox.
- Data model now includes sync identity, provider ids, cursors, raw/sanitized body split, attachments, tags, and idempotency keys.
- Surface targets must be opaque stable ids with no PII.
- V1 is narrowed into proofable vertical slices.
- Security/privacy gates are explicit before real OAuth sync and agent curation.

Rejected findings:

- None. Scope was revised instead of defended.

## Next Action

State: `ready-for-agent` for Slice 1 only.

Next agent should create the `boring-mail` project skeleton and implement fixture-backed workbench plugin proof, without Gmail sync or automation.