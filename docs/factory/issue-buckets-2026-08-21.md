# Issue type buckets and purge manifest — 2026-08-21

Cross-link: builds on [`issue-audit-2026-08-19.md`](issue-audit-2026-08-19.md) and [`task-system-cleanup-proposal.md`](task-system-cleanup-proposal.md) r4/r3 Part 5. Live capture: **68 open GitHub issues**, **263 non-closed beads**, and **74 Project #7 items**. The audit bead itself is included in the Beads census.

## Two independent axes

**Type** answers *what kind of item is this?* **Home** answers *where should it be visible?* They never substitute for one another. A `bug` can be GH-public, beads-only, or parked; an `epic` can likewise be public or internal. The r3/r4 public-window decision remains the home rule: `GH-public` is curated outside-facing narrative, `beads-only` is internal executable truth, and `parked` is deferred discovery hidden from the active window.

### Type taxonomy

| Bucket | Definition | Boundary rule |
|---|---|---|
| `bug` | Observed incorrect behavior, regression, security flaw, or performance failure. | Must describe a failure of existing behavior, not a desired capability. |
| `feature` | Bounded product or platform capability with an implementation outcome. | Default for delivery slices that are neither defects nor umbrellas. |
| `epic` | Multi-slice program, story, or orchestration umbrella. | Holds children; not itself a one-session implementation slice. |
| `chore-ops` | Maintenance, migration, release, cleanup, infrastructure, or operational action. | Value is system health/operation rather than a user capability. |
| `docs` | Documentation or runbook is the primary deliverable. | Code may be referenced, but prose/visual guidance is the outcome. |
| `research-idea` | Uncommitted idea, vertical, deferred option, or market/technology research. | No approved delivery commitment; park by default. |
| `spike` | Time-bounded investigation, audit, plan, decision, qualification, or proof. | Produces evidence/decision, not production behavior. |

## Reconciled counts

- Systems: GitHub **68** + Beads **263** = **331** rows.
- Type buckets: `bug` 43, `feature` 109, `epic` 38, `chore-ops` 16, `docs` 3, `research-idea` 104, `spike` 18.
- Home: GH-public **107**, beads-only **101**, parked **123**.
- Verdict: `defer-protected` 37, `keep` 256, `keep-public` 16, `purge-bead` 7, `purge-gh-internal` 8, `purge-gh-park` 7.

## Every open GitHub issue

| Issue | Created | Type bucket | Home | Verdict | Labels | Title |
|---|---|---|---|---|---|---|
| #371 | 2026-06-23 | bug | beads-only | purge-gh-internal | bug, ready-for-agent | Handle Codex context_length_exceeded during compaction/continue |
| #391 | 2026-06-25 | epic | GH-public | keep-public | enhancement, ready-for-agent | Domain-routed agent workspaces, then multi-agent and runtime expansion |
| #601 | 2026-07-10 | bug | beads-only | purge-gh-internal | bug | WorkspaceAgentFront: provisionWorkspace=false disables remote chat sessions |
| #790 | 2026-07-16 | feature | parked | defer-protected | enhancement | Associate workspace layout state with chat sessions |
| #819 | 2026-07-18 | feature | parked | purge-gh-park | — | #391 Observability and usage metering for agent workspaces |
| #848 | 2026-07-20 | chore-ops | parked | defer-protected | enhancement, needs-info | Merge plugin-authoring resources into plugin CLI and retire boring-pi |
| #857 | 2026-07-20 | bug | parked | defer-protected | bug | Playground dev servers cannot be started concurrently — shared-package clean-rebuild races corrupt dist/ |
| #873 | 2026-07-20 | bug | beads-only | defer-protected | bug, package:cli, plugin:ask-user, ready-for-agent | CLI ask_user flow should not require refresh / disable refresh while awaiting input |
| #877 | 2026-07-20 | chore-ops | beads-only | defer-protected | enhancement, ready-for-human | Decommission legacy Fly.io and Neon hosting safely |
| #882 | 2026-07-21 | feature | parked | defer-protected | enhancement, package:ui, ready-for-agent | Diagram plugin: support tldraw as an alternative to Excalidraw |
| #883 | 2026-07-21 | bug | beads-only | purge-gh-internal | bug, ready-for-human | fix(workspace): clear stale app-left action indicator |
| #900 | 2026-07-22 | feature | beads-only | defer-protected | enhancement, ready-for-agent | Add a thin full-catalog Composio mode to boring-mcp |
| #905 | 2026-07-22 | feature | GH-public | keep-public | enhancement, ready-for-human | Extract multi-Agent Host and Gateway boundary |
| #1009 | 2026-07-31 | feature | beads-only | purge-gh-internal | — | Lane: chat streaming durability (Level B → Level D) |
| #1011 | 2026-07-31 | feature | beads-only | defer-protected | — | Lane: external MCP — user-registered servers |
| #1028 | 2026-07-31 | chore-ops | beads-only | defer-protected | — | Remove unused MessageTimeline renderer |
| #1060 | 2026-08-04 | feature | beads-only | defer-protected | enhancement, ready-for-human | Complete addressed multi-Agent UI and remaining post-AgentHost Wave 1 guarantees |
| #1081 | 2026-08-05 | epic | GH-public | keep-public | — | Epic: sandbox worker runtime — salvage SBX1.3 (Docker+runsc session-lifetime) |
| #1082 | 2026-08-05 | epic | GH-public | keep-public | — | Epic: BYOK tenant keys — salvage 16f.2 vault storage (KMS backend) |
| #1083 | 2026-08-05 | feature | parked | defer-protected | — | Workspace pane: open a running playground on a worktree (Environment lease per pane) |
| #1084 | 2026-08-05 | research-idea | parked | defer-protected | — | Outreach links for anonymous leads (idea, from stale PR #352) |
| #1094 | 2026-08-05 | feature | parked | defer-protected | enhancement | Adopt conditional Questionnaire UX for ask_user |
| #1106 | 2026-08-06 | epic | GH-public | keep-public | — | Epic: production fleet loader + factory seams (multi-agent activation) |
| #1107 | 2026-08-06 | epic | GH-public | keep-public | — | Epic: agent definition as plugin package (agent = installable, versioned, trusted) |
| #1110 | 2026-08-06 | epic | GH-public | keep-public | — | Epic: UI surface optimization loop (factory-run) |
| #1123 | 2026-08-07 | epic | GH-public | keep-public | — | Epic: executable environments — per-agent fs + exec grants (configurable multi-root execution) |
| #1125 | 2026-08-07 | epic | GH-public | keep-public | — | Epic: automation run leases — reclaim orphaned hosted runs safely (multi-replica) |
| #1127 | 2026-08-07 | epic | GH-public | keep-public | — | Epic: external channels — consume agents from WhatsApp/email/SMS (channel adapters over durable streams) |
| #1129 | 2026-08-07 | epic | GH-public | keep-public | — | Epic: MCP ingress — external agents consume a boring-ui workspace (un-dark /mcp/managed-agent) |
| #1167 | 2026-08-08 | spike | parked | defer-protected | — | [epic #1081] remote-worker nonce store: per-tenant sub-budget (cross-tenant DoS, LOW) + SBX1.4/1.5 audit hand-offs |
| #1171 | 2026-08-08 | feature | beads-only | defer-protected | — | Agent details: Reload agent affordance after editing persona instructions |
| #1177 | 2026-08-09 | epic | GH-public | keep-public | — | Epic: visual project documentation — structure, connectors, flows at a glance |
| #1185 | 2026-08-09 | feature | beads-only | defer-protected | — | Remove runtime-identity v1 migration seam once all deployments have migrated (transitional code, D10) |
| #1187 | 2026-08-10 | epic | GH-public | keep-public | — | Epic: migrate the Boring Factory onto the boring-ui CLI workspace (dogfood the product) |
| #1189 | 2026-08-10 | feature | beads-only | defer-protected | — | Resolve Agent instruction refs per request so CLI hub mode gets working links |
| #1190 | 2026-08-10 | feature | beads-only | defer-protected | — | [epic #1110] Surface: unify pane-resizer UX across all split surfaces |
| #1196 | 2026-08-10 | feature | beads-only | defer-protected | — | [epic #1187] One symlink in ~/.pi/agent/skills 500s every agent-scoped route (PATH_SYMLINK_ESCAPE) |
| #1210 | 2026-08-10 | epic | parked | purge-gh-park | — | Epic: CH trades agent — WhatsApp + email-drafting vertical (fiduciaries, craftsmen, storage, garden) |
| #1213 | 2026-08-10 | research-idea | parked | purge-gh-park | — | Idea: Swiss admin agent — per-canton administrative-procedure knowledge corpus (skill + product + SEO) |
| #1214 | 2026-08-10 | research-idea | parked | purge-gh-park | — | Idea: Swiss tax agent — per-canton tax copilot (declarations, deductions, deadlines) |
| #1215 | 2026-08-10 | research-idea | parked | purge-gh-park | — | Idea: health-insurance broker agent (LAMal/VVG) — comparison, switching season, lead machine |
| #1216 | 2026-08-10 | research-idea | parked | purge-gh-park | — | Idea: commercial-register handling agent (registre du commerce / Zefix) |
| #1217 | 2026-08-10 | research-idea | parked | purge-gh-park | — | Idea: Swiss case-law research agent (ATF + cantonal jurisprudence) |
| #1223 | 2026-08-11 | chore-ops | beads-only | defer-protected | — | Retire BORING_AGENT_FLEET flag → config-presence-driven composition + document local-vs-hosted split |
| #1224 | 2026-08-11 | epic | parked | defer-protected | — | Epic: ad-hoc audio transcription — batch mode for the transcription service (streaming exists) |
| #1226 | 2026-08-11 | epic | parked | defer-protected | enhancement, architecture, story | Epic (REWRITE NEEDED): bounded tool catalog — grant-scoped residency, lexical search, child-call dispatch |
| #1233 | 2026-08-12 | docs | beads-only | defer-protected | documentation, enhancement | DX: reduce onboarding from 6 required concepts to 2 (plus one verified scaffold defect) |
| #1240 | 2026-08-12 | feature | parked | defer-protected | — | Provider registry: adding a sandbox provider should touch boring-sandbox (+agent) only |
| #1253 | 2026-08-13 | bug | beads-only | purge-gh-internal | — | ui-review tooling leaks a mktemp -d per run (thousands of /tmp dirs, exhausts tmpfs inodes) |
| #1254 | 2026-08-13 | feature | beads-only | defer-protected | — | Dev VM: /tmp needs an aging rule + pnpm store must never live on tmpfs |
| #1261 | 2026-08-13 | epic | GH-public | keep-public | enhancement, architecture, story | Epic: hosted external plugins — user-authored UI + agent, safely (Seneca) |
| #1274 | 2026-08-14 | feature | beads-only | defer-protected | — | Hosted delegation: trusted AgentHost-native delegate_task plugin |
| #1275 | 2026-08-14 | feature | beads-only | defer-protected | — | Hosted web access: governed request-scoped search and fetch plugin |
| #1276 | 2026-08-14 | feature | beads-only | defer-protected | — | Orchestrator agent plugin: dispatch trigger + fleet tool over automation primitives |
| #1290 | 2026-08-14 | bug | beads-only | defer-protected | — | Composer shows a stale local model selection, not the model the session is actually using |
| #1295 | 2026-08-14 | bug | beads-only | defer-protected | — | Stop deletes queued messages: user-typed content is lost with no recovery |
| #1296 | 2026-08-14 | feature | beads-only | defer-protected | — | Factory workspace shows a generic 'Agent' seat and an Agent nav tab alongside the real fleet |
| #1297 | 2026-08-14 | feature | beads-only | defer-protected | — | Opening several files in a row shows only the last one: no tab representation for file surfaces |
| #1298 | 2026-08-14 | feature | beads-only | defer-protected | — | Add session context menu with Archive session |
| #1300 | 2026-08-14 | bug | beads-only | purge-gh-internal | bug | Automation-created session is absent from inventory and cannot open |
| #1303 | 2026-08-15 | bug | GH-public | keep-public | — | App is very slow on mobile: 4.3 MB eager entry bundle blocks first interaction |
| #1306 | 2026-08-15 | bug | beads-only | defer-protected | bug, needs-triage | ask_user: supersede or withdraw stale intentions when re-raising gates |
| #1307 | 2026-08-15 | bug | beads-only | defer-protected | — | Session rename does not stick: title reverts to auto-derived name |
| #1314 | 2026-08-17 | feature | beads-only | purge-gh-internal | — | Store the request ledger outside the user workspace |
| #1323 | 2026-08-17 | feature | beads-only | defer-protected | — | Sending a message is not smooth: no optimistic echo, chat visibly reloads before the message appears |
| #1337 | 2026-08-19 | bug | beads-only | defer-protected | — | Inbox shows placeholder titles and drops pending questions (3 of 6 shown) |
| #1338 | 2026-08-19 | bug | beads-only | purge-gh-internal | — | Session inventory scans and parses the whole transcript store per request (16s list, 'Preparing workspace' hang) |
| #1344 | 2026-08-21 | bug | GH-public | keep-public | bug, ready-for-agent | Agent edits are invisible in an open Markdown editor |

## Every non-closed bead

| Bead | Status | Type bucket | Home | Verdict | GH | Title |
|---|---|---|---|---|---|---|
| wt-391-forward-0jpy | open | epic | GH-public | keep | #905, #909 | gh-909 AgentGateway v0 execution |
| wt-391-forward-0jpy.10 | open | feature | GH-public | keep | #861, #905, #909 | 909 follow-up — remove #861 Bash/Sandbox back-edges |
| wt-391-forward-0jpy.11 | open | feature | GH-public | keep | #905, #909 | 909 v2 tracer — one remote Host with service-auth send and events |
| wt-391-forward-0jpy.12 | open | feature | GH-public | keep | #905, #909 | 909 follow-up — migrate automation tool to class-2 schema projection |
| wt-391-forward-0jpy.13 | open | feature | GH-public | keep | #905, #909 | 909 v2 prerequisite — remove plugin loopback and dev-bypass trust |
| wt-391-forward-0jpy.14 | open | feature | GH-public | keep | #905, #909 | 909 follow-up — activate durable request ledger and activity state |
| wt-391-forward-0jpy.15 | open | feature | GH-public | keep | #905, #909 | 909 follow-up — contract duplicate AgentLiveEventBuffer |
| wt-391-forward-0jpy.16 | open | feature | GH-public | keep | #905, #909 | 909 v2 hardening — grants, pool, placement, and additive surfaces |
| wt-391-forward-0jpy.17 | open | chore-ops | GH-public | keep | #905 | 909 chore — split first-party plugins into plugins-workspace/ and plugins-agent/ |
| wt-391-forward-0jpy.3 | open | feature | GH-public | keep | #905, #909 | 909 MIG-WS — align Workspace servers and front addressing |
| wt-391-forward-0jpy.4 | open | feature | GH-public | keep | #905, #909 | 909 MIG-CORE — align Core production composition |
| wt-391-forward-0jpy.5 | open | feature | GH-public | keep | #905, #909 | 909 MIG-CLI — align CLI composition and native session layout |
| wt-391-forward-0jpy.6 | open | feature | GH-public | keep | #905, #909 | 909 MIG-PG — align agent-playground composition |
| wt-391-forward-0jpy.7 | open | feature | GH-public | keep | #905, #909 | 909 MIG-DEL — align delegation onto AgentGateway |
| wt-391-forward-0jpy.8 | open | feature | GH-public | keep | #905, #909 | 909 follow-up — wire durable streaming core |
| wt-391-forward-0jpy.9 | open | feature | GH-public | keep | #905, #909 | 909 follow-up — revive authored Agent catalog |
| wt-391-forward-0zq | open | chore-ops | beads-only | keep | — | AppLeftPane session rows: memoization + callback-stability perf pass |
| wt-391-forward-1009-durability-readiness-204 | open | feature | beads-only | keep | #1009 | Durable-stream readiness/observability surface |
| wt-391-forward-1009-sync-driver-blocking-ek2 | open | bug | beads-only | keep | #1009 | Durable store: sync driver blocks event loop up to 5s |
| wt-391-forward-1011-ask-user-approval-boundary-mcv | open | feature | beads-only | keep | #1011 | 1011: ask-user approval boundary for user-registered tool calls |
| wt-391-forward-1011-connect-time-ssrf-x35 | open | feature | beads-only | keep | #1011 | Connect-time SSRF enforcement for user-registered MCP |
| wt-391-forward-1011-credential-custody-wuz | open | feature | beads-only | keep | #1011 | 1011: per-server credential custody for user-registered sources |
| wt-391-forward-1011-guard-discriminator-c2z | open | feature | beads-only | keep | #1011 | MCP: guards keyed on discriminator string are bypassable by rename |
| wt-391-forward-1011-resolve-mcpserverrefs-3sz | open | feature | beads-only | keep | #1011, #1087 | 1011: resolve mcpServerRefs through the #1087 grant seam |
| wt-391-forward-1011-user-registered-source-type-xtg | open | feature | beads-only | keep | #1011 | 1011: user-registered MCP source type + template escape hatch |
| wt-391-forward-1011-workspace-mcp-pane-custom-url-k1k | open | feature | beads-only | keep | #1011 | 1011: Workspace MCP pane — register custom server URL |
| wt-391-forward-1051-dead-replace-branch-za5 | open | chore-ops | beads-only | keep | #1051 | Remove dead sole-pane replace branch after #1051 |
| wt-391-forward-1123-exec-env-plan-45l | open | spike | GH-public | keep | #1123 | Steward plan: executable environments (gh-1123) |
| wt-391-forward-1127-channels-plan-4fv | open | spike | GH-public | keep | #1127 | Steward plan: external channels (gh-1127) |
| wt-391-forward-1127-channels-plan-4fv.1 | open | feature | GH-public | keep | #1127 | WhatsApp step 0: Meta App Review + Business verification submission |
| wt-391-forward-1127-channels-plan-4fv.2 | open | feature | GH-public | keep | #1127 | WhatsApp slice 1a: channel core, bindings, inbound path |
| wt-391-forward-1127-channels-plan-4fv.3 | open | feature | GH-public | keep | #1127 | WhatsApp slice 1b: durable tail, turn assembly, outbound, 24h window |
| wt-391-forward-1127-channels-plan-4fv.4 | open | feature | GH-public | keep | #1127 | WhatsApp slice 2: deployment on the app host |
| wt-391-forward-1127-channels-plan-4fv.5 | open | feature | GH-public | keep | #1127 | WhatsApp slice 3: approval-in-WhatsApp via ask-user |
| wt-391-forward-1127-channels-plan-4fv.6 | open | feature | GH-public | keep | #1127 | WhatsApp slice 4: artifact drop (share-link + PDF) |
| wt-391-forward-1127-channels-plan-4fv.7 | open | feature | GH-public | keep | #1127 | WhatsApp slice 5: inbound media (photos, voice notes) |
| wt-391-forward-1127-channels-plan-4fv.8 | open | feature | GH-public | keep | #1127 | WhatsApp slice 6: thin Cloud API provider adapter (seed Flue + Hermes) |
| wt-391-forward-16f | open | spike | GH-public | keep | #1082 | KEY0: decide model-key policy (BYOK per workspace v1) |
| wt-391-forward-16f.1 | in_progress | feature | GH-public | keep | #1082 | 16f.1 BYOK credential-injection CONTRACT + provider-registry seam |
| wt-391-forward-16f.2 | open | feature | GH-public | keep | #1082 | 16f.2 BYOK vault storage: KmsBackend + OVH-KMS default + local-KEK fallback |
| wt-391-forward-16f.3 | open | feature | GH-public | keep | #1082 | 16f.3 BYOK onboarding flow: provider registry + API-key + OAuth |
| wt-391-forward-16f.4 | open | feature | GH-public | keep | #1082 | 16f.4 BYOK MCP generalization onto shared mechanism (+ pi MCP edge reuse) |
| wt-391-forward-16f.5 | open | feature | GH-public | keep | #1082 | 16f.5 BYOK first-party proxy tools (Tier-1 host-side: web-search + transcription) |
| wt-391-forward-16f.6 | deferred | research-idea | parked | keep | #1082 | 16f.6 (DEFERRED) BYOK in-sandbox injection (Tier-2, untrusted custom tools) |
| wt-391-forward-16f.7 | open | feature | GH-public | keep | #1082 | 16f.7 BYOK migration off WORKSPACE_SETTINGS_ENCRYPTION_KEY |
| wt-391-forward-17q | deferred | research-idea | parked | keep | — | AC1-D-SPEC: accept durable dispatcher micro-spec |
| wt-391-forward-26v | open | spike | beads-only | keep | — | T1.0: recut durable transport plan per Decision 26; candidate consumer named |
| wt-391-forward-2bd | deferred | research-idea | parked | keep | — | BL1 owner gate: name engagement-billing use case |
| wt-391-forward-2md | open | epic | GH-public | keep | #391 | Story #391: Pluggable-Agent Platform & Runtime Refactor |
| wt-391-forward-2md.1 | open | epic | GH-public | keep | #391 | Story 391.1: Multi-Agent Production Hosting & Packaging (D1 remaining) |
| wt-391-forward-2md.2 | open | epic | GH-public | keep | #391 | Story 391.2: MCP Ingress & Shareable Artifacts (AR1, M2, E2) |
| wt-391-forward-2md.3 | open | epic | GH-public | keep | #391 | Story 391.3: Durable Event Transport (T1, T2) |
| wt-391-forward-2md.4 | open | epic | GH-public | keep | #391 | Story 391.4: Sandbox Isolation & S3/FUSE Mounts (P2, X1) |
| wt-391-forward-2md.5 | open | epic | GH-public | keep | #391 | Story 391.5: Marketplace Path (ID1, AC1, BL1, MK1, CH1) |
| wt-391-forward-2pd | deferred | research-idea | parked | keep | — | CH1 owner gate: name consumer-channel use case |
| wt-391-forward-4u4r | in_progress | spike | beads-only | keep | — | issue audit execution 2026-08-19 |
| wt-391-forward-4yi6 | in_progress | bug | beads-only | keep | #1307 | Session rename must stick (auto-title overwrites user rename) |
| wt-391-forward-6au | open | spike | beads-only | keep | — | P2.0: recut boring-sandbox extraction plan per Decision 26 + agent-cloud vision |
| wt-391-forward-6er | deferred | research-idea | parked | keep | — | ID1-004 RFC 9728 protected-resource metadata |
| wt-391-forward-6gd | deferred | research-idea | parked | keep | #1081 | SBX1: own-cloud sandbox provider (remote-worker executor fleet + runsc isolation) |
| wt-391-forward-6gd.2 | in_progress | spike | GH-public | keep | #1081 | SBX1.2: define the production V3 qualification contract and bundle tooling |
| wt-391-forward-6gd.3 | open | feature | GH-public | keep | #1081 | SBX1.3: implement the session-lifetime Docker+runsc worker runtime |
| wt-391-forward-6gd.4 | open | feature | GH-public | keep | #1081 | SBX1.4: wire and freeze the minimal VPS daemon and remote pair end to end |
| wt-391-forward-6gd.5 | open | docs | GH-public | keep | #1081 | SBX1.5: publish exact qualification bundle, gate fleet admission, and publish the runbook |
| wt-391-forward-6gd.6 | open | feature | GH-public | keep | #1081 | SBX1.6: canary and flip the SaaS default to own-cloud remote-worker |
| wt-391-forward-6gd.7 | deferred | research-idea | parked | keep | #1081 | SBX1.7 (deferred): harden box trust and daemon-host metadata access |
| wt-391-forward-6gd.8 | deferred | research-idea | parked | keep | #1081 | SBX1.8 (deferred): set tenant-density tiers and fleet CVE failover economics |
| wt-391-forward-6gd.9 | deferred | research-idea | parked | keep | #819, #1081 | SBX1.9 (deferred): set recovery objectives and #819 black-box observability |
| wt-391-forward-7dw1 | in_progress | bug | beads-only | keep | — | present-pr: mermaid renders as raw text in viewer; sankey must default to code-only |
| wt-391-forward-7t6 | deferred | research-idea | parked | keep | — | AC1-P governed projection generalization |
| wt-391-forward-7zl | deferred | research-idea | parked | keep | — | E2 recut capability-gated MCP environment projection |
| wt-391-forward-8ps | deferred | research-idea | parked | keep | — | ID1-005 resource-token validation on every MCP request |
| wt-391-forward-8yz | deferred | research-idea | parked | keep | — | AR1-003 Lane W membership-gated /a deep-link route |
| wt-391-forward-95nr | in_progress | bug | beads-only | keep | — | Drop buggy github-pr-tracker and ccusage-dashboard runtime plugins |
| wt-391-forward-970-followup-host-dedup-do3 | open | chore-ops | beads-only | keep | — | 970 follow-up: dedupe host package-resource orchestration |
| wt-391-forward-970-followup-type-direction-hxi | open | chore-ops | beads-only | keep | — | 970 follow-up: type ownership direction |
| wt-391-forward-971-main-sync-ld9 | open | chore-ops | beads-only | keep | #942, #971 | Sync #971 onto main (post-970) |
| wt-391-forward-991 | deferred | research-idea | parked | keep | — | ID1-009 owner gate: name stock CIMD client |
| wt-391-forward-9jxj | in_progress | bug | beads-only | keep | #1290 | Composer must show the model the session is actually using |
| wt-391-forward-9sr | open | chore-ops | beads-only | keep | — | boring-bash: tenant fs name leaks in generic shared types |
| wt-391-forward-atx | deferred | research-idea | parked | keep | — | AR1 Lane X immutable cross-workspace artifact delivery |
| wt-391-forward-b7g | deferred | research-idea | parked | keep | — | P2 external P5/BBP5-002 prerequisite attestation |
| wt-391-forward-bug-371-context-overflow-n0z | open | bug | beads-only | keep | #371 | Bug: context-overflow crash on compaction (gh-371) |
| wt-391-forward-bug-601-provision-remote-eal | open | bug | beads-only | keep | #601 | Bug: provisionWorkspace=false kills remote chat (gh-601) |
| wt-391-forward-bug-873-askuser-refresh-0dg | open | bug | beads-only | keep | #873 | Bug: ask_user needs refresh (gh-873) |
| wt-391-forward-bug-883-stale-indicator-9th | open | bug | beads-only | keep | #883 | Bug: stale app-left indicator (gh-883) |
| wt-391-forward-bug-agent-css-wipe-xqj | open | bug | beads-only | keep | — | Bug: agent CSS dist wiped by JS-only rebuilds |
| wt-391-forward-byok-dek-rotation-fil | open | feature | GH-public | keep | #1082 | BYOK: implement DEK-generation rotation (crypto-shred lever) |
| wt-391-forward-byok-version-rollback-0th | open | bug | GH-public | keep | #1082 | BYOK: credential version rollback not prevented |
| wt-391-forward-c6zh | in_progress | feature | beads-only | keep | — | inbox reconciliation 2026-08-19 |
| wt-391-forward-c9t | deferred | research-idea | parked | keep | — | MK1 minimal contractable-agent catalog |
| wt-391-forward-ca3b | open | research-idea | beads-only | keep | — | Spike: factory-in-a-sandbox — clone boring-ui into a Blaxel sandbox and run the factory there |
| wt-391-forward-cli-workspaces-factory-automation-9rju | in_progress | bug | beads-only | keep | — | Investigate CLI workspaces-mode factory automation scheduling |
| wt-391-forward-core-tenant-fs-constant-m46 | open | chore-ops | beads-only | keep | — | Remove tenant fs constant from core shared types |
| wt-391-forward-csk | deferred | research-idea | parked | keep | — | T1/T2 named durable-contract consumer trigger |
| wt-391-forward-d5nj | in_progress | epic | GH-public | keep | #1187 | Epic orchestration B: factory-on-CLI hardening |
| wt-391-forward-d5nj.1 | in_progress | bug | GH-public | keep | #1187, #1199 | gh-1199 honestly deflake insufficient-credit replay |
| wt-391-forward-d5nj.2 | in_progress | feature | GH-public | keep | #1187, #1191 | gh-1191 local CLI reads ambient context files |
| wt-391-forward-d5nj.3 | open | bug | GH-public | keep | #1187, #1196 | gh-1196 isolate invalid ambient skill symlinks |
| wt-391-forward-d5nj.4 | open | bug | GH-public | keep | #1187, #1253 | gh-1253 stop ui-review mktemp leaks |
| wt-391-forward-d5nj.5 | open | bug | GH-public | keep | #1187, #1254 | gh-1254 safe tmpfs aging and inode preflight |
| wt-391-forward-eq8 | deferred | research-idea | parked | keep | — | AR1-004 minimal MCP server resource support for shares |
| wt-391-forward-ez6 | open | feature | beads-only | keep | — | UI loop: ChatLayout drawers lack dialog semantics (focus trap/Escape/scroll lock) |
| wt-391-forward-few | deferred | research-idea | parked | keep | — | M2 recut canonical MCP agent exposure |
| wt-391-forward-fg4 | deferred | research-idea | parked | keep | — | X1 S3/FUSE mount lifecycle and corrected benchmark |
| wt-391-forward-fwh | open | spike | beads-only | keep | — | OB0: observability and metering plan per Decision 26 |
| wt-391-forward-g5em | open | spike | beads-only | keep | — | Plan revision: unify Tasks view across beads and GitHub |
| wt-391-forward-gb0o | in_progress | epic | GH-public | keep | #1110 | Epic orchestration A: UI polish blitz |
| wt-391-forward-gb0o.1 | open | bug | GH-public | keep | #1110, #1300 | Automation-created session must remain in inventory and openable |
| wt-391-forward-gb0o.2 | in_progress | feature | GH-public | keep | #1110, #1304 | Inline ask_user artifact list in chat |
| wt-391-forward-gh912-live-transcript-8r4g | ready_for_human | feature | beads-only | keep | #912 | GH-912 local CPU live transcript V0 |
| wt-391-forward-i99 | deferred | research-idea | parked | keep | — | BL1 engagement billing decorator and budgets |
| wt-391-forward-inbox-human-first-ask-user-fnfk | in_progress | feature | beads-only | keep | — | Inbox: human-first ask_user cards |
| wt-391-forward-issue-type-buckets-bh1p | in_progress | feature | beads-only | keep | — | Bucket all live GitHub issues and beads; propose purge |
| wt-391-forward-itk | open | bug | beads-only | keep | — | 3 pre-existing overlay test failures on main (Skills overlay switching) |
| wt-391-forward-k9p | deferred | research-idea | parked | keep | — | CH1 Telegram consumer channel binding |
| wt-391-forward-kev | deferred | research-idea | parked | keep | — | X1 external E1/P5 prerequisite attestation |
| wt-391-forward-kjz8 | open | feature | beads-only | keep | — | Session context menu with Archive session |
| wt-391-forward-kon | deferred | research-idea | parked | keep | — | AC1-M contracted mode as a decorator |
| wt-391-forward-la3 | deferred | research-idea | parked | keep | — | T2 shared ChatTransport conformance and UI cutover |
| wt-391-forward-merge-after-human-approval-rn4m | open | feature | beads-only | keep | — | Workers merge exact-SHA PRs after human approval |
| wt-391-forward-mwy | deferred | research-idea | parked | keep | — | P2 sandbox provider extraction and EU viability proof |
| wt-391-forward-n9bd | in_progress | bug | beads-only | keep | — | File surfaces need tabs: opening several files in a row shows only the last |
| wt-391-forward-n9y | deferred | research-idea | parked | keep | — | MK1 owner gate: name catalog discovery use case |
| wt-391-forward-nnn | open | bug | beads-only | keep | — | Runtime-identity migration: stale-lock TTL + error diagnostics + workspace-level test |
| wt-391-forward-oc2 | deferred | research-idea | parked | keep | — | AR1 Lane X gate: focused staged-write/recovery protocol review |
| wt-391-forward-p820 | ready_for_human | bug | beads-only | keep | — | Inbox must show question titles and ALL pending questions |
| wt-391-forward-pci | deferred | research-idea | parked | keep | — | ID1-008 hard per-workspace metering spend cap |
| wt-391-forward-pke | open | chore-ops | beads-only | keep | — | Reconcile mobile breakpoint split: shell flips at 639px, ResponsiveDockviewShell declares 768/1024 |
| wt-391-forward-pmz | open | epic | beads-only | keep | #775 | Native Pi session and task binding MVP |
| wt-391-forward-pmz.1 | deferred | research-idea | parked | keep | — | PR 1: native Pi session creation and rename |
| wt-391-forward-pmz.2 | open | feature | beads-only | keep | — | PR 2: task to native Pi session bindings |
| wt-391-forward-pmz.2.1 | open | feature | beads-only | keep | — | PR 2a: binding core and first-send handoff |
| wt-391-forward-pmz.2.2 | open | feature | beads-only | keep | — | PR 2b: task session menu, status, and navigation |
| wt-391-forward-pmz.2.3 | open | feature | beads-only | keep | — | PR 2c: YAML task artifact folder |
| wt-391-forward-pmz.2.4 | open | feature | beads-only | keep | — | PR 2d: authoritative session status seam |
| wt-391-forward-pr-1256-r2-research-reconcile-e9t9 | in_progress | research-idea | beads-only | keep | #1256, #1317 | PR #1256 r2: reconcile provider registry with PR #1317 research |
| wt-391-forward-pr-1333-ci-followup-mvhk | in_progress | bug | beads-only | keep | #1333 | PR #1333 follow-up: restore green CI |
| wt-391-forward-pr-1333-followup-4bmo | in_progress | chore-ops | beads-only | keep | #1333 | PR #1333 follow-up: fix CI and re-gate |
| wt-391-forward-pr-1339-r2-followup-vzf2 | in_progress | feature | beads-only | keep | #1339 | PR #1339 r2 follow-up: resolve owner-note conflict |
| wt-391-forward-psc | deferred | research-idea | parked | keep | — | AC1-H engagement data-boundary hygiene |
| wt-391-forward-pwd | deferred | research-idea | parked | keep | — | T1 completion durable event/replay/approval contract |
| wt-391-forward-q3l | deferred | research-idea | parked | keep | — | ID1-002 minimal Hydra login and consent through existing app auth |
| wt-391-forward-rctz | in_progress | feature | beads-only | keep | — | Orchestrator agent plugin: dispatch trigger + boring_fleet tool |
| wt-391-forward-rjkl | in_progress | epic | GH-public | keep | #1129 | Epic orchestration C: external MCP ingress |
| wt-391-forward-rjkl.1 | in_progress | spike | GH-public | keep | #1129 | #1129 Today/Delta canonical ingress plan + gate-1 pack |
| wt-391-forward-rjkl.2 | in_progress | feature | GH-public | keep | #900, #1129 | #900.1 thin full-catalog Composio backend reland |
| wt-391-forward-rjkl.3 | open | feature | GH-public | keep | #1129 | #1129 bounded retry-safe MCP ingress admission |
| wt-391-forward-rjkl.4 | open | feature | GH-public | keep | #1129 | #1129 bind MCP ingress to current Workspace AgentGateway authority |
| wt-391-forward-rjkl.5 | open | feature | GH-public | keep | #1129 | #1129 stock-client full-app ingress qualification |
| wt-391-forward-s4wq | open | bug | beads-only | keep | — | Session inventory: cache+paginate, never full-store parse; isolate e2e session roots |
| wt-391-forward-seneca-competitor-cloudflare-os-n50 | open | research-idea | beads-only | purge-bead | — | Study competitor: Cloudflare OS (Seneca) |
| wt-391-forward-seneca-competitor-getenergy-qaf | open | research-idea | beads-only | purge-bead | — | Study competitor: getenergy.com (Seneca) |
| wt-391-forward-si4 | deferred | research-idea | parked | keep | — | ID1-003 unique OIDC identity link and personal-workspace ensure |
| wt-391-forward-sl7 | open | feature | beads-only | keep | — | 1107 slice 1: persona discovery via asset manager + pi.skills grammar |
| wt-391-forward-step1a-current-xn9 | in_progress | epic | GH-public | keep | #391, #805 | #391/#805 Decision 28: application Agent fleet, Workspace orchestration, and Environment service |
| wt-391-forward-step1a-current-xn9.1 | deferred | epic | parked | keep | #391, #805 | #805 foundation: WorkspaceRuntime, typed bindings, declarative A1, regular dev |
| wt-391-forward-step1a-current-xn9.1.2 | deferred | epic | parked | keep | #391 | R1: extract one shared WorkspaceRuntime and embeddable WorkspaceAgentHost |
| wt-391-forward-step1a-current-xn9.1.2.1 | deferred | research-idea | parked | keep | #391 | R1.1: WorkspaceRuntime primitive, descriptor, cache, and rollback |
| wt-391-forward-step1a-current-xn9.1.2.2 | deferred | research-idea | parked | keep | #391 | R1.2: migrate standalone, Core, and CLI workspaces mode to one host |
| wt-391-forward-step1a-current-xn9.1.2.3 | deferred | research-idea | parked | keep | #391 | R1.3: generation-safe reload, leases, eviction, and retirement |
| wt-391-forward-step1a-current-xn9.1.2.4 | deferred | research-idea | parked | keep | #391 | R1.4: freeze compatibility and runtime-owner invariants |
| wt-391-forward-step1a-current-xn9.1.3 | deferred | epic | parked | keep | #391 | R2a: actor-neutral binding facade and session authority |
| wt-391-forward-step1a-current-xn9.1.3.1 | deferred | research-idea | parked | keep | #391 | R2a.1: narrow AgentBinding and mint operation/session handles |
| wt-391-forward-step1a-current-xn9.1.3.2 | deferred | research-idea | parked | keep | #391 | R2a.2: actor-multiplexing session router and typed history semantics |
| wt-391-forward-step1a-current-xn9.1.3.3 | deferred | research-idea | parked | keep | #391 | R2a.3: static tools and actor/session-neutral plugin state |
| wt-391-forward-step1a-current-xn9.1.3.4 | deferred | research-idea | parked | keep | #391 | R2a.4: exhaustive route/session strategy conformance |
| wt-391-forward-step1a-current-xn9.1.4 | deferred | epic | parked | keep | #391 | R2b: authorized request/background ingress and consumer migration |
| wt-391-forward-step1a-current-xn9.1.4.1 | deferred | research-idea | parked | keep | #391 | R2b.1: short-lived issuers and single-use target-bound operations |
| wt-391-forward-step1a-current-xn9.1.4.2 | deferred | research-idea | parked | keep | #391 | R2b.2: migrate Core, MCP, automation, and trusted plugin consumers |
| wt-391-forward-step1a-current-xn9.1.4.3 | deferred | research-idea | parked | keep | #391 | R2b.3a: deletion preflight, global fences, and durable retirement classification |
| wt-391-forward-step1a-current-xn9.1.4.4 | deferred | research-idea | parked | keep | #391 | R2b.4: cohort revocation and compatibility freeze |
| wt-391-forward-step1a-current-xn9.1.4.5 | deferred | research-idea | parked | keep | #391 | R2b.3b: replica-wide runtime retirement and operation drain |
| wt-391-forward-step1a-current-xn9.1.4.6 | deferred | research-idea | parked | keep | #391 | R2b.3c: durable session/plugin cleanup and provider/user finalization |
| wt-391-forward-step1a-current-xn9.1.5 | deferred | epic | parked | keep | #391 | R3: static multi-agent policy, plugin views, and typed singleton map |
| wt-391-forward-step1a-current-xn9.1.5.1 | deferred | research-idea | parked | keep | #391 | R3.1: validate global agent definitions and Workspace-type policy |
| wt-391-forward-step1a-current-xn9.1.5.2 | deferred | research-idea | parked | keep | #391 | R3.2: provisioning union and enforceable resource generations |
| wt-391-forward-step1a-current-xn9.1.5.3 | deferred | research-idea | parked | keep | #391 | R3.3: lazy typed bindings, capabilities contract, and failure isolation |
| wt-391-forward-step1a-current-xn9.1.5.4 | deferred | research-idea | parked | keep | #391 | R3.4: canonical two-agent shared-runtime conformance |
| wt-391-forward-step1a-current-xn9.1.7 | deferred | epic | parked | keep | #391 | R5: regular-server agent dev and exact package conformance |
| wt-391-forward-step1a-current-xn9.1.7.1 | deferred | research-idea | parked | keep | #391 | R5.1: implement one-shot and loopback agent dev on the regular server |
| wt-391-forward-step1a-current-xn9.1.7.2 | deferred | research-idea | parked | keep | #391 | R5.2: plugin-cli migration, package cohort, docs, and foundation closeout |
| wt-391-forward-step1a-current-xn9.10 | open | feature | GH-public | keep | #391 | F2b-i: implement local boring-bash Environment service |
| wt-391-forward-step1a-current-xn9.11 | open | feature | GH-public | keep | #391 | F2b-ii: migrate every Environment consumer and prove provider coherence |
| wt-391-forward-step1a-current-xn9.12 | open | feature | GH-public | keep | #391 | F3a: add dedicated AgentApplication entrypoint and static fleet validator |
| wt-391-forward-step1a-current-xn9.13 | open | feature | GH-public | keep | #391, #844 | F4a: add hosted default persistence and correct #844 semantics |
| wt-391-forward-step1a-current-xn9.14 | open | feature | GH-public | keep | #391 | F4b: implement local registry locking and acting-Agent session metadata |
| wt-391-forward-step1a-current-xn9.15 | open | feature | GH-public | keep | #391 | F3b-i: build Workspace single-Agent orchestrator on real Environment service |
| wt-391-forward-step1a-current-xn9.16 | open | feature | GH-public | keep | #391 | F3b-ii: generation-safe AgentApplication lifecycle and internal two-Agent seam |
| wt-391-forward-step1a-current-xn9.17 | open | feature | GH-public | keep | #391 | F5a: compose Core/web consumer, signup intent, and hosted model issuer |
| wt-391-forward-step1a-current-xn9.18 | open | spike | GH-public | keep | #391, #845 | F5b: recreate sibling auth security proof and supersede PR #845 |
| wt-391-forward-step1a-current-xn9.19 | open | feature | GH-public | keep | #391 | F6: compose independent CLI fleet/Workspace consumer and regular agent dev |
| wt-391-forward-step1a-current-xn9.2 | deferred | epic | parked | keep | #391 | #391 Core product track: exact domain, typed authorization/create, and UX |
| wt-391-forward-step1a-current-xn9.2.1 | deferred | research-idea | parked | keep | #391 | C1: CoreProductRequestScope and two-domain authentication topology |
| wt-391-forward-step1a-current-xn9.2.2 | deferred | research-idea | parked | keep | #391 | C2: route-wide typed membership authorization and Workspace selection |
| wt-391-forward-step1a-current-xn9.2.3 | deferred | research-idea | parked | keep | #391 | C3: durable idempotent typed Workspace creation and provisioning admission |
| wt-391-forward-step1a-current-xn9.2.4 | deferred | research-idea | parked | keep | #391 | C4: typed Workspace UX and executed rollback floor |
| wt-391-forward-step1a-current-xn9.20 | open | feature | GH-public | keep | #391 | F7: prove two-Agent governance, canonical data, and leak isolation |
| wt-391-forward-step1a-current-xn9.21 | open | feature | GH-public | keep | #391 | H2c Human Intention: approve exact compatibility contraction and file deletions |
| wt-391-forward-step1a-current-xn9.22 | open | feature | GH-public | keep | #391 | F2c: contract only owner-approved Agent-coupled Environment exports |
| wt-391-forward-step1a-current-xn9.23 | open | feature | GH-public | keep | #391 | F8a: qualify contracted packed release candidate and Seneca rollback |
| wt-391-forward-step1a-current-xn9.24 | open | chore-ops | GH-public | keep | #391 | H8 Human Intention: approve one exact immutable publication cohort |
| wt-391-forward-step1a-current-xn9.25 | open | chore-ops | GH-public | keep | #391 | F8b: publish approved cohort and prove clean Seneca production install |
| wt-391-forward-step1a-current-xn9.26 | deferred | research-idea | parked | keep | #391 | H4a conditional Human Intention: map non-default workspaceTypeId data if audit triggers |
| wt-391-forward-step1a-current-xn9.3 | deferred | epic | parked | keep | #391 | I1/R6: Seneca two-product integration and Step 1A release proof |
| wt-391-forward-step1a-current-xn9.3.1 | deferred | research-idea | parked | keep | #16, #391 | R6.1: replace Seneca #16 with declarative sources and trusted plugins |
| wt-391-forward-step1a-current-xn9.3.2 | deferred | research-idea | parked | keep | #391 | R6.2: production qualification, typed rollback/restore, and closeout |
| wt-391-forward-step1a-current-xn9.3.3 | deferred | research-idea | parked | keep | #391 | I0: publish and registry-verify the exact R0-R5 package cohort |
| wt-391-forward-step1a-current-xn9.4 | deferred | epic | parked | keep | #391 | Deferred follow-ups after the Step 1A multi-agent foundation |
| wt-391-forward-step1a-current-xn9.4.1 | deferred | research-idea | parked | keep | #391 | Follow-up: design Boring as a Pi package/extension seam |
| wt-391-forward-step1a-current-xn9.4.2 | deferred | research-idea | parked | keep | #391 | Follow-up: WorkspaceRuntime backend for pi-subagents |
| wt-391-forward-step1a-current-xn9.4.3 | deferred | research-idea | parked | keep | #391 | Follow-up: human agent selector, switch, and session fork UX |
| wt-391-forward-step1a-current-xn9.4.4 | deferred | research-idea | parked | keep | #391 | Follow-up: decide workspace-type plugin route gating |
| wt-391-forward-step1a-current-xn9.4.5 | deferred | research-idea | parked | keep | #391 | Follow-up: audit optional fatal tool-collision mode |
| wt-391-forward-step1a-current-xn9.5 | in_progress | spike | GH-public | keep | #391 | F0a: ratify Decision-28 authority and replacement Bead graph |
| wt-391-forward-step1a-current-xn9.6 | open | spike | GH-public | keep | #391 | F0b: refresh current-main consumer, provider, publication, and migration inventory |
| wt-391-forward-step1a-current-xn9.7 | open | feature | GH-public | keep | #391 | F1a: freeze Environment operation and logical-binding contract |
| wt-391-forward-step1a-current-xn9.8 | open | feature | GH-public | keep | #391 | F1b: freeze Environment admission, lifecycle, grants, and host-root ports |
| wt-391-forward-step1a-current-xn9.9 | open | spike | GH-public | keep | #391 | F2a: neutralize Sandbox backend contract and ratify provider enforcement |
| wt-391-forward-t4g | open | feature | beads-only | keep | — | Automation plugin: per-automation agent selection (fleet-aware) |
| wt-391-forward-tm49 | in_progress | bug | beads-only | keep | — | CLI must start in a normal project folder: stop resolving pi runtime from workspace node_modules |
| wt-391-forward-ui-mobile-workspace-shell-wyb | open | feature | beads-only | keep | — | UI loop: mobile workspace shell polish pass |
| wt-391-forward-ui-multiagent-surfaces-sj0 | open | feature | GH-public | keep | #1102, #1110 | UI loop: multi-agent surfaces (blocked on #1102) |
| wt-391-forward-uvt | deferred | research-idea | parked | keep | — | AR1 Lane X owner trigger: named design-partner engagement brief |
| wt-391-forward-vertical-agents-epic-nfgt | open | epic | parked | keep | #1210 | Vertical agents — Swiss SMB product line |
| wt-391-forward-vertical-agents-epic-nfgt.1 | deferred | research-idea | parked | keep | #1210 | Vertical: Kitchen & bath renovation, Romandie (PILOT) |
| wt-391-forward-vertical-agents-epic-nfgt.10 | open | research-idea | parked | purge-bead | #1210 | Vertical: Architects (BACKLOG) |
| wt-391-forward-vertical-agents-epic-nfgt.11 | open | research-idea | parked | keep | #1210, #1213 | Vertical: Swiss admin-procedures agent (knowledge/copilot) |
| wt-391-forward-vertical-agents-epic-nfgt.12 | open | research-idea | parked | keep | #1210, #1214 | Vertical: Swiss tax agent (knowledge/copilot) |
| wt-391-forward-vertical-agents-epic-nfgt.13 | open | research-idea | parked | keep | #1210, #1215 | Vertical: Health-insurance broker agent — LAMal/VVG (knowledge/copilot) |
| wt-391-forward-vertical-agents-epic-nfgt.14 | open | research-idea | parked | keep | #1210, #1216 | Vertical: Commercial-register handling agent (knowledge/copilot) |
| wt-391-forward-vertical-agents-epic-nfgt.15 | open | research-idea | parked | keep | #1210, #1217 | Vertical: Swiss case-law research agent (knowledge/copilot) |
| wt-391-forward-vertical-agents-epic-nfgt.2 | open | feature | parked | keep | #1210 | Vertical: MacroAnalyst — finance/macro (LIVE) |
| wt-391-forward-vertical-agents-epic-nfgt.3 | open | research-idea | parked | keep | #1210 | Vertical: Immobilier / régies — real estate + property mgmt (RESEARCHED) |
| wt-391-forward-vertical-agents-epic-nfgt.4 | open | research-idea | parked | keep | #1210 | Vertical: IT consulting / consultant placement, Vaud (RESEARCHED-partial) |
| wt-391-forward-vertical-agents-epic-nfgt.5 | open | research-idea | parked | keep | #1210 | Vertical: Courtiers en assurance — insurance brokers (RESEARCHED) |
| wt-391-forward-vertical-agents-epic-nfgt.6 | open | research-idea | parked | purge-bead | #1210 | Vertical: Fiduciaries — accounting/trustee (BACKLOG) |
| wt-391-forward-vertical-agents-epic-nfgt.7 | open | research-idea | parked | purge-bead | #1210 | Vertical: Craftsmen / hand workers — plumbers, electricians, roofers, heating/solar (BACKLOG) |
| wt-391-forward-vertical-agents-epic-nfgt.8 | open | research-idea | parked | purge-bead | #1210 | Vertical: Garden / landscaping (BACKLOG) |
| wt-391-forward-vertical-agents-epic-nfgt.9 | open | research-idea | parked | purge-bead | #1210 | Vertical: Storage / self-storage companies (BACKLOG) |
| wt-391-forward-wecd | in_progress | spike | beads-only | keep | #1166 | PR #1166 follow-up: stress-test environment mounts against long-term meta plan |
| wt-391-forward-wmj | deferred | research-idea | parked | keep | — | Managed B2B contracting engagement trigger |
| wt-391-forward-wrr | deferred | research-idea | parked | keep | — | AC1-D durable in-process subagent dispatcher |
| wt-391-forward-wul5 | open | bug | beads-only | keep | — | Stop must not delete queued messages |
| wt-391-forward-x3d | deferred | research-idea | parked | keep | — | ID1-007 boring-owned API-key credentials |
| wt-391-forward-xp3s.10 | open | feature | GH-public | keep | #1106 | Signup-domain default initialization conformance |
| wt-391-forward-xp3s.11 | deferred | research-idea | parked | keep | #1106 | MacroAnalyst fleet-of-one production proof using existing credits |
| wt-391-forward-xp3s.17 | open | feature | GH-public | keep | #1106 | Add agentTypeId attribution to existing model-run metering |
| wt-391-forward-xp3s.2 | open | feature | GH-public | keep | #1106 | D30 bounded presentation-only landing |
| wt-391-forward-xp3s.3 | open | spike | GH-public | keep | #1106 | Macro app-owned exact-SHA deploy identity and rollback proof |
| wt-391-forward-xp3s.4 | in_progress | spike | GH-public | keep | #1106 | Local Agent package lifecycle conformance + version inventory |
| wt-391-forward-xp3s.7 | deferred | research-idea | parked | keep | #1106 | Architecture gate: remote Agent package trust + upgrade contract |
| wt-391-forward-xp3s.8 | deferred | research-idea | parked | keep | #1106 | Architecture gate: standalone Agent remote consumption binding |
| wt-391-forward-xp3s.9 | in_progress | feature | GH-public | keep | #1106 | Persisted default-Agent legacy migration then fail closed |
| wt-391-forward-y0d | deferred | research-idea | parked | keep | — | ID1-009 CIMD fetch/validation when stock client requires it |
| wt-391-forward-ybkr | in_progress | bug | beads-only | keep | — | Mobile: split the 4.3MB eager entry bundle |
| wt-391-forward-yeh | open | docs | beads-only | keep | — | BYOK: operator recovery runbook for the version-anchor SPOF |
| wt-391-forward-yqvu | open | bug | beads-only | keep | — | Hide the legacy default agent and the Agent nav tab when a fleet is composed |
| wt-391-forward-yv0 | deferred | research-idea | parked | keep | — | ID1/BL1 owner gate: assign durable workspace-budget ownership and cap |
| wt-391-forward-z2qt | in_progress | bug | GH-public | keep | #1344 | Agent edits are invisible in an open Markdown editor |
| wt-391-forward-zdw | deferred | research-idea | parked | keep | — | ID1-006 bounded Dynamic Client Registration verification |
| wt-391-forward-znz | deferred | research-idea | parked | keep | — | X1 owner gate: name native-mount consumer |
| wt-391-forward-zwt | deferred | research-idea | parked | keep | — | ID1-001 Hydra service and idempotent external-Postgres migration |

## GitHub Project #7 — retire it

**Confirmed stale, not refuted.** Project #7 has **74 items**: 19 Done, 54 Backlog, 1 Doing. Of them, **54 are drafts**, only **20 are linked issues**, only **one currently-open repository issue (#905)** is represented, and the sole `Doing` row is #905. **73/74 items have not been updated in at least seven days**; the latest project item update was 2026-08-19. Repo search finds historical intake instructions and this cleanup proposal, but no automation or factory code that writes Project #7. Live Beads has many claimed items while the Project still says one Doing.

Recommendation: close (archive) the whole project, not 74 hand-maintained rows one by one:

```bash
gh project close 7 --owner hachej
```

This loses the Project from active roadmap views and disables normal editing while closed. It **does not delete** its 74 items, custom fields, descriptions, or history; rollback is exact and reversible:

```bash
gh project close 7 --owner hachej --undo
```

Deleting individual items (`gh project item-delete 7 --owner hachej --id <item-id>`) would permanently remove project membership/field values and provides no benefit once the whole stale mirror is closed, so it is explicitly rejected.

## Purge manifest — commands listed, not executed before owner approval

### Mandatory execution-time preflight

Approval applies only to the exact target SHA and captured rows. Immediately before mutation, re-run the three live inventories below. **Abort the whole purge** if any target issue has gained an open PR, any matching bead has entered `in_progress`/`ready_for_human`, a target issue is no longer open, or the deliverable SHA changed. The executable checker below binds the gate-named SHA, validates every target and retained counterpart, and exits non-zero before any mutation on drift. Run the mutation block immediately after `PREFLIGHT OK`; no partial execution on drift.

```bash
export APPROVED_SHA='<exact SHA named by this approval gate>'
test "$(git rev-parse HEAD)" = "$APPROVED_SHA" || { echo 'ABORT: SHA drift'; exit 1; }
git diff --quiet "$APPROVED_SHA" -- docs/factory/issue-buckets-2026-08-21.md .handoff/issue-buckets.html || { echo 'ABORT: deliverable drift'; exit 1; }
gh issue list --state open --limit 200 --json number,title,labels,createdAt > /tmp/issue-buckets-preflight-gh.json
gh pr list --state open --limit 200 --json number,title,body,closingIssuesReferences > /tmp/issue-buckets-preflight-prs.json
br --db /home/ubuntu/projects/boring-ui-v2/.beads/beads.db list --json > /tmp/issue-buckets-preflight-beads.json
gh project view 7 --owner hachej --format json > /tmp/issue-buckets-preflight-project.json
python3 - <<'PY'
import json,re,sys
abort=lambda why: (print(f'ABORT: {why}',file=sys.stderr),sys.exit(1))
targets={371,601,819,883,1009,1210,1213,1214,1215,1216,1217,1253,1300,1314,1338}
open_issues={x['number'] for x in json.load(open('/tmp/issue-buckets-preflight-gh.json'))}
missing=targets-open_issues
if missing: abort(f'target issues no longer all open: {sorted(missing)}')
for pr in json.load(open('/tmp/issue-buckets-preflight-prs.json')):
    text=' '.join([pr.get('title') or '',pr.get('body') or ''])
    refs={int(x) for x in re.findall(r'(?:#|gh-)(\d+)',text,re.I)}
    refs|={x['number'] for x in pr.get('closingIssuesReferences',[]) if x.get('number')}
    hit=refs&targets
    if hit: abort(f'open PR #{pr["number"]} now references targets {sorted(hit)}')
beads=json.load(open('/tmp/issue-buckets-preflight-beads.json'))['issues']
expected={
 371:['bug-371-context-overflow-n0z'],601:['bug-601-provision-remote-eal'],819:['-fwh'],
 883:['bug-883-stale-indicator-9th'],1009:['1009-sync-driver-blocking-ek2','1009-durability-readiness-204','-0jpy.8'],
 1210:['vertical-agents-epic-nfgt'],1213:['vertical-agents-epic-nfgt.11'],
 1214:['vertical-agents-epic-nfgt.12'],1215:['vertical-agents-epic-nfgt.13'],1216:['vertical-agents-epic-nfgt.14'],
 1217:['vertical-agents-epic-nfgt.15'],1253:['-d5nj.4'],1300:['-gb0o.1'],1314:['-0jpy.14'],1338:['-s4wq']}
for n,tokens in expected.items():
    matches=[b for b in beads if any(t in b['id'] for t in tokens)]
    if not matches: abort(f'no retained Bead counterpart for #{n}')
    active=[b['id'] for b in matches if b['status'] in ('in_progress','ready_for_human')]
    if active: abort(f'#{n} counterpart became active: {active}')
for b in beads:
    if b['status'] not in ('in_progress','ready_for_human'): continue
    text=' '.join([b.get('external_ref') or '',b.get('title') or '',b.get('description') or '',' '.join(b.get('labels') or [])])
    refs={int(x) for x in re.findall(r'(?:issues/|#|gh-|issue-)(\d+)',text,re.I)}
    hit=refs&targets
    if hit: abort(f'active Bead {b["id"]} now references targets {sorted(hit)}')
project=json.load(open('/tmp/issue-buckets-preflight-project.json'))
if project.get('closed'): abort('Project #7 already closed/drifted')
purge_beads={'wt-391-forward-seneca-competitor-cloudflare-os-n50','wt-391-forward-seneca-competitor-getenergy-qaf','wt-391-forward-vertical-agents-epic-nfgt.6','wt-391-forward-vertical-agents-epic-nfgt.7','wt-391-forward-vertical-agents-epic-nfgt.8','wt-391-forward-vertical-agents-epic-nfgt.9','wt-391-forward-vertical-agents-epic-nfgt.10'}
state={b['id']:b['status'] for b in beads}
drift={i:state.get(i) for i in purge_beads if state.get(i)!='open'}
if drift: abort(f'Bead purge targets drifted: {drift}')
print('PREFLIGHT OK: exact SHA; 17 GH targets open/unprotected; counterparts retained/inactive; Project open; 7 Bead targets open.')
PY
```

Rows lacking a durable Bead counterpart are protected rather than closed. That preserves r4's “every GH issue maps to Beads” prerequisite; creating those missing epics/tasks is a separate migration, not silently bundled into this purge.

### Eligible GitHub closes (15)

These rows have neither an open PR reference nor an `in_progress`/`ready_for_human` bead. Their work/idea remains in Beads.

```bash
gh issue close 371 -c "Issue-bucket cleanup 2026-08-21: tracked in Beads; internal implementation detail removed from the public issue window."
gh issue close 601 -c "Issue-bucket cleanup 2026-08-21: tracked in Beads; internal implementation detail removed from the public issue window."
gh issue close 819 -c "Issue-bucket cleanup 2026-08-21: parked in deferred Beads; no longer part of the public product window."
gh issue close 883 -c "Issue-bucket cleanup 2026-08-21: tracked in Beads; internal implementation detail removed from the public issue window."
gh issue close 1009 -c "Issue-bucket cleanup 2026-08-21: tracked in Beads; internal implementation detail removed from the public issue window."
gh issue close 1210 -c "Issue-bucket cleanup 2026-08-21: parked in deferred Beads; no longer part of the public product window."
gh issue close 1213 -c "Issue-bucket cleanup 2026-08-21: parked in deferred Beads; no longer part of the public product window."
gh issue close 1214 -c "Issue-bucket cleanup 2026-08-21: parked in deferred Beads; no longer part of the public product window."
gh issue close 1215 -c "Issue-bucket cleanup 2026-08-21: parked in deferred Beads; no longer part of the public product window."
gh issue close 1216 -c "Issue-bucket cleanup 2026-08-21: parked in deferred Beads; no longer part of the public product window."
gh issue close 1217 -c "Issue-bucket cleanup 2026-08-21: parked in deferred Beads; no longer part of the public product window."
gh issue close 1253 -c "Issue-bucket cleanup 2026-08-21: tracked in Beads; internal implementation detail removed from the public issue window."
gh issue close 1300 -c "Issue-bucket cleanup 2026-08-21: tracked in Beads; internal implementation detail removed from the public issue window."
gh issue close 1314 -c "Issue-bucket cleanup 2026-08-21: tracked in Beads; internal implementation detail removed from the public issue window."
gh issue close 1338 -c "Issue-bucket cleanup 2026-08-21: tracked in Beads; internal implementation detail removed from the public issue window."
```

### Protected GitHub rows (37) — **not in the executable manifest**

| Issue | Intended home | Why deferred |
|---|---|---|
| #790 | parked | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #848 | parked | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #857 | parked | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #873 | beads-only | Do not close while open PR #1325. |
| #877 | beads-only | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #882 | parked | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #900 | beads-only | Do not close while open PR #1309 and active bead wt-391-forward-rjkl.2. |
| #1011 | beads-only | Do not close while active bead wt-391-forward-rjkl.1. |
| #1028 | beads-only | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #1060 | beads-only | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #1083 | parked | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #1084 | parked | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #1094 | parked | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #1167 | parked | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #1171 | beads-only | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #1185 | beads-only | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #1189 | beads-only | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #1190 | beads-only | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #1196 | beads-only | Do not close while active bead wt-391-forward-d5nj.2. |
| #1223 | beads-only | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #1224 | parked | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #1226 | parked | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #1233 | beads-only | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #1240 | parked | Do not close while open PR #1256 and no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #1254 | beads-only | Do not close while PR #1320 closed unmerged; r3 prerequisite not met. |
| #1274 | beads-only | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #1275 | beads-only | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #1276 | beads-only | Do not close while open PR #1288 and active bead wt-391-forward-rctz. |
| #1290 | beads-only | Do not close while open PR #1319 and active bead wt-391-forward-9jxj. |
| #1295 | beads-only | Do not close while open PR #1301. |
| #1296 | beads-only | Do not close while open PR #1301. |
| #1297 | beads-only | Do not close while open PR #1301 and active bead wt-391-forward-n9bd. |
| #1298 | beads-only | Do not close while open PR #1301. |
| #1306 | beads-only | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #1307 | beads-only | Do not close while open PR #1316 and active bead wt-391-forward-4yi6. |
| #1323 | beads-only | Do not close while no identifiable durable Bead counterpart yet (r4 prerequisite). |
| #1337 | beads-only | Do not close while open PR #1343 and active bead wt-391-forward-p820. |

Re-evaluate each only after every named PR closes and every named bead leaves `in_progress`/`ready_for_human`; do not infer that approval of this manifest covers those future closes.

### Project retirement (1)

```bash
gh project close 7 --owner hachej
```

### Bead closes (7)

These are the only Beads rows with positive evidence of irrelevance/completion. Closing them does not delete their descriptions or history.

```bash
br --db /home/ubuntu/projects/boring-ui-v2/.beads/beads.db close wt-391-forward-seneca-competitor-cloudflare-os-n50 --reason "Research is complete and already captured in the competitor study document."
br --db /home/ubuntu/projects/boring-ui-v2/.beads/beads.db close wt-391-forward-seneca-competitor-getenergy-qaf --reason "Research is complete and conclusions are already captured in the competitor study document."
br --db /home/ubuntu/projects/boring-ui-v2/.beads/beads.db close wt-391-forward-vertical-agents-epic-nfgt.10 --reason "Rejected for v1: architecture tenders are long dossier work, not rapid quote-shaped work."
br --db /home/ubuntu/projects/boring-ui-v2/.beads/beads.db close wt-391-forward-vertical-agents-epic-nfgt.6 --reason "Rejected vertical: accounting/trustee was ranked worst-fit and has no selected execution path."
br --db /home/ubuntu/projects/boring-ui-v2/.beads/beads.db close wt-391-forward-vertical-agents-epic-nfgt.7 --reason "Unselected broad trades backlog; renovation pilot carries the chosen wedge."
br --db /home/ubuntu/projects/boring-ui-v2/.beads/beads.db close wt-391-forward-vertical-agents-epic-nfgt.8 --reason "Rejected vertical: landscaping maintenance is below the ticket/value bar."
br --db /home/ubuntu/projects/boring-ui-v2/.beads/beads.db close wt-391-forward-vertical-agents-epic-nfgt.9 --reason "Rejected vertical: self-storage is low-ticket recurring rental, the wrong product shape."
```

### Execution totals if approved exactly

- Close **15** GitHub issues.
- Close/archive **1** GitHub Project (preserving all 74 rows/history).
- Close **7** beads.
- Keep **53** GitHub issues open now, including **37** temporarily protected internal/parked rows.
- No item with an open PR or an active (`in_progress`/`ready_for_human`) bead is in the executable close set.
