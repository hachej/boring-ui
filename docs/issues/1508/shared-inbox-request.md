# [Shared Inbox] One Factory host, many epics, one Inbox

Owner request (2026-09-04). Today `apps/factory-playground` is one process per epic: one workspace root, one epic key baked into the seat instructions, one Beads database, one sandbox provider, one Inbox. Running several epics or several repositories means several UIs and several Inboxes. The owner wants one Factory host that hosts N epic workspaces (any repository) with a single shared Inbox.

Prior art to copy, not reinvent: the CLI hub (`packages/cli/src/server/modeApps.ts`, `localWorkspaces.ts`) already serves many workspaces from one process, keyed by the `x-boring-workspace-id` header, with per-workspace lazy state maps, per-request agent scope resolution, and a persisted workspace registry. Agent sessions are already namespaced by workspace scope (`packages/agent/src/server/agent-host/sessionInventory.ts`).

## Slices, in dependency order

1. **[Shared Inbox] Epic workspace registry** — a persisted registry of epic workspaces `{ id, featureName, epicKey, root, repoUrl, branch, provider }` under the Factory state root; `epic up|down` register/unregister into a running host instead of spawning a process; `/api/v1/workspace/meta` and every route resolve the workspace from the header. Risk: the fleet is composed at boot with one epic key; it must be composed per workspace at registration and never reused across epics.
2. **[Shared Inbox] Per-workspace host state** — Beads ops, delegate/status, supervision, demo, sandbox provider and snapshot registry become lazy `Map<workspaceId, …>` factories, created on register, disposed on unregister, warm-up per epic. Depends on 1.
3. **[Shared Inbox] Seats bound per workspace** — one agent host; the epic binding, feature name and precedence appendices are resolved per workspace scope (the hub's `resolveAuthorizedAgentRuntimeScope` pattern), so `[Feature Name]` titles and `epic:<key>` labels come from the workspace the request is served from. Depends on 1.
4. **[Shared Inbox] Cross-workspace Inbox** — tag ask-user questions with workspace id and feature name, aggregate pending questions across registered workspaces in one route, extend the Inbox overlay to list `[Feature Name] …` entries from all epics and route each answer back to its workspace's runtime. Depends on 2 and 3.

## Proof

`pnpm exec tsc --noEmit` and `pnpm exec vitest run` in `apps/factory-playground`; a live run registering two epics (this repo and `hachej/boring-cdc`) into one host and answering both Gate 1 questions from the same Inbox.

## Out of scope

Merging, per-repository personas, quota handling for Vercel.
