# Factory Hub request

Owner ruling: 2026-09-05

## Today

`createFactoryHost` binds one epic per process: `epicKey`, `featureName`, and
`workspaceRoot` are boot options; the fleet appendix, delegate tools
(`dispatch_worker`/`fresh_review`), supervision, demo, sandbox, `close_epic`,
and `/api/v1/workspace/meta` all close over that epic. Three epics of the same
repository therefore require three processes, UIs, and Inboxes on separate
port pairs. The owner rejected this: epics operating on the same repository
must live in the same playground.

## Target

Run one Factory host process per machine. Its workspace root is the canonical,
read-mostly repository checkout (`repositoryRoot`, for example
`/home/ubuntu/projects/boring-ui-v2`) which remains on `main`. It hosts many
epics concurrently with one sessions list and one Inbox.

Each epic keeps its own worktree at
`<repositoryRoot>/.worktrees/epic-<key>` on `epic/<key>`, Orchestrator session
titled `[<Feature Name>] Orchestrator`, Workers/reviewers, supervision entry,
sandbox snapshot, and demo. A later host may hold epics from multiple
repositories, so registry entries carry `repositoryRoot` and no implementation
may assume the host workspace root equals an epic worktree. Multi-repository
intake is not part of this request.

## Design

1. Add `plugins/boring-factory/src/server/host/epicRegistry.ts`. Persist
   `<stateRoot>/epics.json` atomically with entries containing `epicKey`,
   `featureName`, `worktree`, `branch`, `repositoryRoot`, optional
   `requestFile`, optional per-seat models, optional
   `orchestratorSessionId`, `createdAt`, and active/closed status. Validate the
   key slug and prove the worktree exists as a git worktree of its repository.
   Preserve `deriveFactoryWorkspaceScopeId`, but make the host scope
   `factory-hub` so ask-user supplies one Inbox.

2. Add `sessionBindings.ts`. Persist `sessionId → epicKey` in
   `<stateRoot>/session-bindings.json`. Bind an Orchestrator at intake/adoption
   and bind every delegated child to its parent's epic. Every Factory host tool
   resolves through its calling session, while also accepting an optional
   explicit `epicKey`; an unbound call must fail clearly and name that override.

3. Refactor host tools away from boot-bound epic state. Delegate briefs begin
   with `Host context: epic <key> ([Feature]) worktree <path> branch <branch>`.
   Supervision records carry epic keys and status is per epic. Demo and sandbox
   state are epic-scoped; the local provider clones the epic worktree HEAD, not
   the canonical host root. `close_epic` marks its registry entry closed. Keep
   `factory-precedence`; replace concrete fleet epic text with a generic
   appendix instructing each seat to use the epic in its first host context.
   Do not change `.agents/**` or fleet-pinned skill digests.

4. Add intake endpoints. `POST /api/v1/factory/epics` registers input
   `{ epicKey, featureName, worktree?, branch?, requestFile?, models?, start? }`.
   When absent, create the worktree with
   `git worktree add -b epic/<key> .worktrees/epic-<key> origin/main`; the host
   never installs or builds. Create/bind the Orchestrator, and when `start` is
   true send a standard planning prompt from plugin-owned
   `buildEpicKickoffPrompt(entry, requestText)`. `GET` lists live Orchestrator,
   pending-gate, Bead-count, and branch-head facts. `POST
   /api/v1/factory/epics/:key/adopt` binds an existing Orchestrator session.
   The three required adoption mappings are:

   - `byok-codex` / `BYOK Codex` /
     `.worktrees/epic-byok-codex` →
     `b6827afe-2b7c-4746-966b-93e5e6f74fe9`
   - `whatsapp-channel` / `WhatsApp Channel` /
     `.worktrees/epic-whatsapp-channel` →
     `bcbe65bb-04bc-4729-bb1f-9c6349ba58db`
   - `mcp-program` / `MCP Program` /
     `.worktrees/epic-mcp-program` →
     `15748389-83cf-4104-892f-b20f407f557b`

   `/api/v1/workspace/meta` returns `projectName: 'Boring Factory'`,
   `workspaceId: 'factory-hub'`, canonical `workspaceRoot`, and the epic list;
   remove singular epic assumptions from the frontend.

5. Change `apps/factory-playground/scripts/factory-epic.mjs`. `up` still
   provisions the worktree, runs `pnpm install --offline --frozen-lockfile`,
   and builds there, then registers with the running hub instead of starting a
   process per epic. `list` reads the intake API. `down` closes the registry
   entry and never deletes the worktree. Add `hub up`; the environment contract
   uses repository-root `BORING_FACTORY_WORKSPACE_ROOT`, shared state root,
   seat models, and sandbox provider. Legacy epic/name variables are one-shot
   boot intake only and must be logged as such.

6. Add a compact Epics frontend: feature, short branch HEAD, Orchestrator
   status, pending-gate badge, and open/closed Bead counts. Clicking opens the
   epic Orchestrator. A New epic form accepts feature name, key, and request
   file. Preserve existing viewport/layout fixes and use inline token styles
   for badges because plugin-source Tailwind classes are not generated.

7. Make `scripts/live-epic-acceptance.mjs` register or select an epic through
   the hub and use the returned Orchestrator. Preserve all flags, including
   owner-handled gates and multi-Bead thresholds. `launch-live-api.sh` starts
   the hub without epic environment variables.

8. Add Vitest coverage for registry load/save/validation, binding persistence,
   inheritance and unbound errors, intake creation/binding/adoption, meta shape,
   and delegated child host context. Update all former singular-epic fixtures.
   Run Factory tests, playground tests/typecheck, and `pnpm lint:invariants`
   without weakening assertions.

9. Update the Factory plugin/app READMEs and reliability documentation.
   Recovery now re-arms supervision for every active registry entry on boot;
   the stale-claim rule does not change.
