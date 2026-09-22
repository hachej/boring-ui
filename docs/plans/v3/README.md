# Boring v3: a network of self-living apps on a hub, with the agent as a service

Status: analysis and direction, owner-reviewed 2026-09-18 to 2026-09-22. Not ratified.
Interactive version with diagrams: [`artifacts/boring-v3-capability-map.html`](artifacts/boring-v3-capability-map.html)
(published copy: https://claude.ai/artifact/V5w5CFJtpjpiFEFFX7iyfW).
Companion plan for the workspace shell: [`chat-first-shell.md`](chat-first-shell.md).

## Thesis

v3 is not a rewrite of the workspace. It is a re-centering: apps are the product, the hub
runs them, Flue runs the agents, and a small set of platform services is consumed through
bindings on the cell. Most of what v3 needs already exists, split across three places:
boring-hub has the app lifecycle, Flue has the durable agent, and boring-ui-v2 has the auth,
payments, sandbox, filesystem and viewer code. What is missing is the wiring between them.

| v2 source triaged | with a port verdict | rewritten on Flue | dropped outright |
| --- | --- | --- | --- |
| 216k lines (190k of tests beside it) | ~125k, trimmed on the way | ~22k (harness, core tools, dock) | ~40k (zero importers or dead) |

## Owner decisions (2026-09-18)

1. **Flue replaces boring-agent's harness layer.** Tools, viewers, ask-user and the session
   UI stay ours. Durable submissions, recovery and the render loop come from Flue. The v2
   durable-streams work (P1-A) is superseded.
2. **v3 supersedes the v2 ratified pack.** Only the nouns survive: Thread, Session, Library,
   artifact, one workbench many mounts. Plans and sequencing retire with v2.
3. **The hub keeps being built in parallel as a standalone**, with no auth and no remote
   sandbox. v3 must consume it, not fork it.
4. **Platform shape: bindings first, backends in-process in the standalone hub, extraction
   later.**
5. **Viewer tools: the v2 guardrail is reversed; html/app is the first viewer with tools.**
6. **The wall comes down by design.** Apps may trigger the agent and apps may call other apps.
   The network contract is a wave 0 deliverable.
7. **Secrets: 1Password is the root of trust, the hub store is the per-tenant backend.**
   Recommended after checking the docs; owner ruling pending.

> **Conflict to record, not to bury.** `docs/plans/long-term/ratified/ARCHITECTURE-PLAN.md`
> line 324 says "No integrating Flue/celld, patterns yes, dependency no", backed by measured
> evidence (empty `process.env` under celld, 435 ms cold start). boring-hub has since proven
> Flue 2.0.8 on celld with facets, 37 of 37 hub e2e passing. Decision 1 supersedes the ruling
> and needs one line in `docs/DECISIONS.md` so rule 11 is honoured rather than skipped.

## The shape

```
PLATFORM SERVICES            HUB (celld)                         CONSUMERS
auth & identity   (v2 core)  ┌──────────────────────────────┐   workspace: Thread + artifact
payments/metering (v2 core)  │ app cell  web·routes·tools.json│   viewers, Library (one consumer
secrets           (v2 vault) │           own SQLite facet     │   among others, Flue protocol)
sandbox exec + fs (v2)       │ app cell  fitness, clinic, …   │   channels (inbound webhooks,
filesystem svc    (v2 bash)  │      ▲ tools mounted inward    │   verified, → dispatch; no outbound)
viewers+tools     (hub)      │      │        publishes ▲      │   other apps (wave 0 design:
ask-user          (hub)      │ agent cell · Flue  one DO per  │   app → agent dispatch, app → app)
        │ bindings           │   conversation, durable        │   browser (signed URL → app cell)
        ▼                    │   submissions, defineTool      │
env.db · env.files ·         │ app-runner  publish → validate │
env.secrets · env.sandbox ·  │   → migrate → activate ·       │
env.user · env.ask ·         │   rollback · versions · signed │
env.views · env.agent ·      │   serving URLs · worker loader │
env.apps                     └──────────────────────────────┘
(today only env.db exists)
```

Apps and agents are cells in the hub. Platform services are consumed through bindings on
the cell, of which only `env.db` exists today. The workspace becomes one consumer of the
agent, as a Thread viewer over the Flue protocol, beside inbound channels and the browser.

## What exists, by source

### boring-hub + celld

Has: app publish, validate, migrate, activate, rollback, versions, logs, signed serving URLs
(37 of 37 e2e). One facet per app with its own SQLite that survives code swaps; migrations
run before `current` moves. The app contract: default-export `fetch(request, env)`, `env.db`,
`x-app-user` header. App and profile as two kinds through one path; tools.json mounted into
the agent as native tools.

Added 19 to 22 Sep on the ship branch: its own shell (~8,600 lines, views as URLs, a 250-line
layout; refuses the v2 composition root, Fastify server, pi host, dockview and file tree).
Viewers: file, markdown, tldraw, dashboard, ui-editor, with browser-side tools returning
through a read-once result mailbox. ask_user as a compare-and-set row. Attachments,
transcription. Named filesystems code, workspace, shared. Multi-app. Multi-user identity in one
function, Cloudflare Access in front, owner and editor sharing, metering. ~22 production
deploys to apps.senecaapp.ai; a real clinic app imported to prod. ~118 test files on node:test.

Lacks: CI of any kind; 266 commits exist only on this VM; eval evidence gitignored; main dead
since 17 Sep. No boundary between apps (one origin, an editor can reach the owner's other apps
and tokens). One role. No console capture. The public authenticated browser path was never
verified, and Access's frame policy blocked the app iframe at last record. celld:
`process.env` never populated, bucket production mode never exercised, no Cloudflare deploy.

### Flue

Has: durable submissions with exactly one terminal outcome, attempt leases, recovery from
durable evidence. Agent as a render function, tools as program logic, MCP connections,
sandbox adapters (E2B, Daytona, Modal, Cloudflare, local, virtual). Persistent state per
conversation, canonical append-only records. Inbound channels for a dozen providers.

Lacks: any auth or tenancy (a conversation URL is full access). Outbound messaging,
app-to-app RPC, a plugin system, secrets beyond env, viewers, ask-user. Durable files
(sandbox files are never stored; the hub's "dev filesystem" is a string map in persistent
state). Code Mode is a parenthetical in a type file, not a feature.

### boring-ui-v2

Has: auth with 28 real migrations. Payments with Stripe and Lemon Squeezy, credits, metering
(parked but written). The execution stack: SandboxProviderV1, direct, bwrap, node-workspace,
leases, and the filesystem HTTP service (~12k lines, zero imports of the agent). AgentGateway
with branded scopes and a conformance suite. Ask-user, automations, tasks, MCP client,
governance, secrets crypto, UI bridge, surface resolvers, ui-kit.

Lacks: viewers with artifact tools (none expose tools to agents, and
`RESERVED_WORKSPACE_BRIDGE_OP_PREFIXES` forbids it with a dedicated test). Publish, version,
undo lifecycle for apps. Two live security defects that must not cross: unsandboxed external
plugin import, and ambient pi auth bypassing BYOK (D27).

## What the apps taught

| Requirement | Who paid | How it was hand-rolled |
| --- | --- | --- |
| Per-user, per-app isolation as a guarantee | fitness, clinic, healio | Fitness: separate container, volume, SQLite, pinned agent dir. Clinic: cross-patient chat state leaked. Healio chose Postgres RLS. |
| Tool policy per app | fitness | A custom pi hook blocking every tool except two. |
| Propose then confirm writes, idempotent drafts | fitness | Drafts table with request keys and hash replay; nothing written until Confirm. |
| Chunked uploads, downloads, ZIP export | clinic | 400 MiB chunked uploader patched across three packages; download did not exist; ZIP still missing. |
| Publish, version, undo, handover lifecycle | one-chat | Spec-sheet status machine, approved-revision counters, append-only CHANGES, handover note, all in skill files. |
| Scoped, rotatable secrets | healio, fitness | 1Password service accounts plus Secrets Manager, OIDC in CI. |
| Version pins as damage control | fitness, clinic | pi pinned to dodge an OAuth regression; clinic frozen on a patched fork. |
| Zero open ports, immutable backups, residency | healio | Cloudflare Tunnel plus Tailscale, Object Lock backups, EU-routed inference. Clinic has none while holding real health data. |
| Deploy with rollback and drain | healio, clinic | Kamal with retained containers; clinic's manual "no active recording" check. |

## What the hub taught in six days

728 commits from 17 to 22 Sep, most on one branch. Verdict: a very good runtime wrapped in a
fragile delivery system. v3 takes the runtime primitives wholesale and none of the delivery
habits.

Take wholesale:
- **Publish implies activate, migrate before switch.** A failing migration stores the version
  and leaves `current` untouched; the migrations ledger only grows, so undo never destroys
  data. No preview stage: publish is live, undo is the safety net.
- **Cells as plugins.** "One app cell is one boring plugin." The answer to v2's unsandboxed
  plugin import and to plugins with no per-user data scope.
- **Views as URLs, layouts as pages.** Four nouns (View, Viewer, Chat, Layout); no layout
  reaches into a viewer, no viewer assumes a layout. For one-chat the v2 shell is redundant.
- **Identity in one function.** Four ordered sources, 401 on null, no default identity.
- **ask_user as a row with compare-and-set.** Mechanism, not prose.
- **Deletion as a deliverable.** The hub unbuilt ~2,000 lines of its own security theatre.

Do differently:
- **Contracts drift in prose within a week.** The three-dependency contract grew a fourth
  binding in four days while the API doc still says three. v3's binding contract is a
  conformance test with a version.
- **Rules do not stop the model, mechanisms do.** Provider names leaked in three fresh
  conversations despite a capabilities file and a closing reminder. Anything forbidden gets a
  refusing tool or a state machine.
- **Render-then-run is a product fact.** A tool published in submission N is callable at N+2.
  Say it in the tool result.
- **Name tools so they cannot read as agents.** Models called `mcp__server__tool` through
  the subagent mechanism; a tool file without frontmatter was silently invisible; "Got it"
  without a write call counted as done. Invisible registration must be a loud error.
- **Green unit tests hid two runtime breaks** (`crypto.randomUUID` in an insecure context,
  raw `BEGIN IMMEDIATE` on DO SQLite). Run conformance on the real cell runtime.
- **Delivery discipline.** No CI, 266 commits only on this VM, evidence gitignored, parallel
  redeploys of the same commit to production, a build step wiping live state twice, secrets
  printed into a transcript. v3 starts with CI and a pushed main on day one.

Two things to close before v3 leans on the hub: the public authenticated browser path has
never been verified from outside an SSH tunnel (and Access's frame policy blocked the app
iframe), and there is no boundary between apps.

## Platform shape

| Shape | For | Against |
| --- | --- | --- |
| A. Extend app-runner | Publish and run already exist; one deploy unit; bindings injected where the wrapper builds `env`. | app-runner is one 1,047-line file; celld is one fleet per application; auth must sit in front of Flue anyway; contradicts "hub stays standalone with no auth". |
| B. Platform service, hub is one client | Services testable on their own; matches the standalone-hub decision; workspace and any host consume the same thing. | An extra hop per binding call; two deploy units on day one; easy to over-build. |
| **Decided: B-shaped contract, A-shaped deployment** | Define the platform as the binding contract on the cell, each backed by a service interface. First backends in-process inside the standalone hub with no auth. Extract only when a second host needs it. | Requires discipline: no app reaches past a binding, ever. The kit enforces it by construction. |

## Capability map

| Capability | v3 provider | Source | v2 lines | Status |
| --- | --- | --- | --- | --- |
| App run and lifecycle | app-runner facets, worker loader | boring-hub | – | exists |
| Agent runtime | Flue agent cell; v2 `AgentHarness` seam shape kept, pi implementation dropped | Flue + rewrite | 8.9k | rewrite |
| Admission and scopes in front of the agent | AgentGateway funnel, branded scope, conformance suite, between consumers and the Flue router | v2 port trimmed | 15.2k | port |
| Core tools | read, write, edit, find, grep, ls, bash, isolated exec, upload as Flue `defineTool` | rewrite on Flue | 2.5k | rewrite |
| Sandbox exec + fs → `env.sandbox` | SandboxProviderV1, direct, bwrap, node-workspace, leases; sandbox plugin's TTL leases | v2 port as is | 6.3k + 1k | port |
| Filesystem service → `env.files` | boring-bash routes (files, dirs, tree, search, events, upload); multi-filesystem bindings with bounds | v2 port trimmed | 7.8k | port |
| Auth and identity → `env.user` | Hub today: Cloudflare Access plus `resolveIdentity`. v2 better-auth with 28 migrations as the self-hosted option behind the same function | hub + v2 port | 1.7k + schema | port behind hub seam |
| Authorization | 3-role RBAC as is; governance trimmed to its capability model; app-on-behalf-of-user grant intersection | v2 port + new | 0.1k + 2.9k | port + new |
| Payments and metering | credits service, Stripe and Lemon Squeezy, metering sink, billing panel | v2 port trimmed | 3.7k | port, parked |
| Secrets → `env.secrets` | Per-tenant secrets in the hub's encrypted SQLite store using v2's envelope crypto. 1Password as root of trust. Ambient-auth bypass removed. | v2 port + 1Password at the root | 1.9k | port + fix |
| Viewers + artifact tools → `env.views` | The hub's five viewers with browser-side tools and views as URLs. v2's renderers ported behind it where the hub has none. First viewer with agent tools: html/app. | hub model + v2 renderers | 7.9k port | exists in hub |
| Ask-user → `env.ask` | The hub's ask_user row with compare-and-set. v2's plugin becomes reference only. | hub | – | exists in hub |
| Propose then confirm | The fitness drafts pattern as a platform primitive under `env.db` | new, from fitness | ~0.3k | new |
| UI bridge and ui tools | 44-line UiCommand contract, exec_ui, get_ui_state, surface resolvers | v2 port trimmed | 3.1k | port |
| Chat as Thread viewer | Chat panel over Flue's state-based protocol; numeric seq and explicit session create must change on the front | v2 port + adapt | agent front | adapt |
| Library | FileTree, dock renderer behind a view host, Dockview types out of the plugin contract | v2 rewrite of layout, port of tree | 1.8k port, 9k rewrite | rewrite |
| Plugin system | definePlugin and defineServerPlugin as a plugin-sdk leaf; plugin code loaded as a cell, never imported into the host | v2 port trimmed + fix | 5.9k | port + fix |
| Channels | Flue channels; ask-user answers, app events and human intention arrive as dispatches | Flue | – | exists |
| App network → `env.agent`, `env.apps` | App dispatches a turn over Flue's existing router; app calls another app's routes under a grant. New: conversation resolution per user, hub-minted short-lived tokens, grants intersected with the user's. | new, on hub + Flue primitives | – | new, wave 0 design |
| Automations, tasks, MCP client, data bridge, explorer, generated pane, deck, diagram | Ported as apps or viewer plugins, one at a time | v2 port trimmed | ~22k | port later |

## Dropped, with sizes

| What | Lines | Why |
| --- | --- | --- |
| runsc/gVisor, remote-worker copy, blaxel providers | 13k | Zero importers. Firecracker superseded gVisor. |
| Dockview-as-workspace: ChatLayout, ChatPaneStageDock, SurfaceShell, dock chrome | 9k | Dockview becomes a renderer behind a view host. |
| God-file composition roots: WorkspaceAgentFront, createWorkspaceAgentServer, createCoreWorkspaceAgentServer, modeApps | 9k | They encode the v2 ontology. |
| Apps: full-app, factory-playground, workspace-playground, agent-playground | 7.9k | Playground glue. Salvage the credits wiring. |
| excalidraw (dead), github-pr-tracker, ccusage-dashboard, live-transcription, sharepoint stub | 8.3k | Unmaintained, self-declared unsupported, or descoped. |
| Factory prose and seat ontology | 125 KB md | Salvage durable supervision timers, delegate child sessions, remote snapshots. |

## Port order: small parts, fast

App sequence: guestbook, fitness, one-chat, clinic. Each wave lands as an importable piece
and is proven by one app on the standalone hub.

0. **Repo, nouns, contract** (1 week, gate). Create boring-ui-v3 with the cell binding
   contract written first: `env.db` as today plus `env.files`, `env.secrets`, `env.sandbox`,
   `env.user`, `env.ask`, `env.views`, each a TypeScript interface with an in-memory reference
   implementation and a conformance test. Network contract: `env.agent.dispatch(input,
   idempotencyKey)` and `env.apps.call(address, route, input)` under a grant; the transport
   is Flue's existing router, the binding resolves the conversation for the user, mints a
   short-lived token bound to app, user and conversation, and forwards. Record the Flue/celld
   ruling and the guardrail reversal in DECISIONS.md. Port ui-kit and theming tokens. Copy
   the hub kit as the app template. Gate: guestbook published from v3 through the standalone
   hub, all bindings but `env.db` stubbed by the reference implementations.
1. **Execution stack behind bindings** (2 weeks). Port the shell-free 12k: SandboxProviderV1
   with direct, bwrap and node-workspace, the leases, the filesystem HTTP service. Wire them
   as the first real backends of `env.sandbox` and `env.files` inside the standalone hub.
   Done when an app cell reads and writes files through `env.files`.
2. **Agent on Flue, chat as Thread viewer** (3 weeks, gate). Rewrite the nine core tools as
   Flue tools. Put the AgentGateway funnel in front of the Flue router, auth off. Adapt the
   chat panel to Flue's state-based protocol. Ask-user as a durable pause on a submission id.
   Tool policy per app on the profile. Propose-then-confirm under `env.db`. Gate: fitness runs
   on the hub with no pi dependency.
3. **Viewers with artifact tools** (3 weeks). Viewer plugins as panel plus scored resolver;
   each viewer may declare agent tools through `env.views`. html/app first. Done when the
   colleague edits an artifact through a viewer tool and the change shows in the artifact
   viewer and the Library.
4. **one-chat on v3** (2 weeks, gate). The colleague as an agent cell, apps as app cells,
   the lifecycle (spec sheet, approved revision, undo as history, handover note) as
   hub-backed primitives. Gate: a non-technical person builds and evolves an app end to end.
   4b. **App layout and in-app chat (portal)** (4 days): a Thread with `layout: "app"`
   renders its html artifact full bleed; the app declares a chat slot over an iframe-to-shell
   postMessage channel and the shell portals the chat there.
5. **Auth, secrets, payments in front** (3 weeks). Port better-auth core as `env.user` and as
   the front layer over the Flue router. Secrets crypto with persistence, ambient-auth bypass
   removed. Credits and metering. Done when a second user on the same hub cannot see the
   first user's threads, files or secrets, proven by a test.
6. **Clinic and the long tail** (ongoing). Chunked upload and download as `env.files`
   features. Clinic as an app cell. Then automations, tasks, MCP client, data bridge, deck,
   diagram, tests first where coverage is under ten percent. Later: native in-app chat as a
   web component shipped into the sandbox, transport only, pi keeps the brain.

## Open decisions

- **Tenancy seam on day one.** The standalone hub runs without auth, but the AgentGateway
  funnel sits in front of Flue from wave 2 so nobody builds on "anyone with the URL".
- **Secrets backend.** Verified against the 1Password docs: vault-per-tenant with a scoped
  service account per vault is possible, but tokens are immutable at creation, the SDK is
  Node-only with no isolate path, and the account-wide cap is 50,000 calls per day on
  Business (10,000 reads and 1,000 writes per hour per token). Their "multi-tenancy" feature
  is the MSP parent-child model. Recommendation: the hub's encrypted SQLite store is what
  `env.secrets` reads per tenant; 1Password holds the master key, platform credentials and
  any tenant-owned service-account tokens. Alternatives if a real per-tenant product is ever
  needed: HashiCorp Vault namespaces or Infisical, both self-hostable.
- **Network grants.** With the wall down, an app calling another app acts on behalf of a user,
  so the grant is the intersection of the user's and the app's. The hub docs already named
  this "the only real design work".

## Sources

Four read-only audits on 2026-09-18 (workspace package, consumer apps, boring-hub + Flue,
boring-ui-v2 capability inventory), the clinic/healio/one-chat/fitness lessons read, the
1Password docs check, and the boring-hub history review on 2026-09-22. The fitness app lives
at `/opt/fitness` on the clinic VPS; its runtime data was never read.
