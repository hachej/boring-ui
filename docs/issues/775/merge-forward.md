# #775 merge-forward resolution

Date: 2026-07-26

## Outcome

Merged the native Pi session work onto the newer Agent Host and addressed-session
architecture from `origin/main`. All conflict markers are gone from tracked
source. The index still reports the 20 paths as `UU` because the coordinator,
not this resolution pass, owns `git add` and the merge commit.

The required behavior is preserved:

- `nativeSessionStartEnabled` is an explicit composition capability. Both
  `createAgentApp` and `registerAgentRoutes` normalize omission to `false`;
  no runtime-mode-derived helper exists.
- CLI, agent playground, workspace playground (local and remote-worker), full
  app, and plugin playground compositions explicitly pass `true`.
- Native first-send idempotency is TTL-only, prunes before lookup, and lazily
  deletes expired rejected starts only when the native session still lacks an
  assistant reply.
- Workspace native adoption updates chat panes, pinned sessions, the handoff
  map, pending handoff prompts, and hydration guards through the central
  `replaceSessionId` / `forgetSession` helpers using main's opaque addressed
  session keys.
- Native identity remains stable through the first trusted send, follow-ups,
  delete/reset/navigation, split panes, and detached views. Rename remains
  gated on a native session with an assistant reply.
- Main's Agent Host compatibility wrapper forwards native first-send and
  rename. Its ledger digest excludes the transport-only `retry` flag, so an
  ambiguous `false` to `true` retry replays the original result.
- Addressed Agent Host inventory can list and resolve bare native transcripts
  only when that runtime scope explicitly opted into native start. Disabled
  scopes remain unable to discover them.
- `plugins/boring-mcp` still rejects a missing verified user with
  `401 UNAUTHORIZED`; it does not create an anonymous namespace.

## Conflict-by-conflict resolution

1. `apps/agent-playground/src/server/index.ts` — kept main's
   `createAgentPlaygroundRuntime` entrypoint; the relocated `agentHost.ts`
   composition now explicitly enables native session start.
2. `packages/agent/src/core/piChatSessionService.ts` — retained main's
   synchronous effect-failure observation and scope identity, applying it to
   #775 create/prompt/rename/delete effects.
3. `packages/agent/src/front/chat/PiChatPanel.tsx` — retained both addressed
   `agentTypeId` routing and ephemeral/native-adoption state, including working
   status continuity.
4. `packages/agent/src/front/chat/pi/remotePiSession.ts` — combined main's
   addressed gateway adapters and receipts with #775's atomic native-first
   adoption and stable `commandSessionId`.
5. `packages/agent/src/front/chat/piChatPanelHooks.ts` — forwards addressed
   identity plus native-first options while keeping adoption callbacks current
   without recreating the remote session.
6. `packages/agent/src/front/chat/session/usePiSessions.ts` — retained main's
   cursor pagination and addressed ordering, plus local drafts, adoption,
   delete/reset continuity, pending rename reconciliation, and assistant-reply
   metadata.
7. `packages/agent/src/server/__tests__/registerAgentRoutes.test.ts` — kept
   main's prebuilt-Agent-Host coverage and restored default-off,
   mode-independent, and custom-adapter native capability cases.
8. `packages/agent/src/server/createAgentApp.ts` — used main's Agent Host
   composition, restored explicit `=== true` normalization, and propagated the
   capability through custom/default harness factories and Pi routes.
9. `packages/agent/src/server/harness/pi-coding-agent/sessions.ts` — kept
   main's runtime-scope pinning, locks, wrapper adoption, and durable title
   ordering; restored direct-native metadata, assistant-reply detection,
   timestamp ordering, safe native rename, and direct-native runtime-scope
   identity reads under the explicit capability.
10. `packages/agent/src/server/http/routes/__tests__/piChat.test.ts` — kept
    main's context/pagination tests and restored default-off, first-send native
    adoption, rename normalization, and active-session validation coverage.
11. `packages/agent/src/server/registerAgentRoutes.ts` — kept main's compact
    legacy-policy wrapper and restored the explicit default-false capability
    passed into that policy.
12. `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.provisioning.test.ts`
    — preserved main's admission/scope tests and adapted #775's opt-in assertion
    to the new legacy-route-policy seam.
13. `packages/workspace/src/app/front/WorkspaceAgentFront.tsx` — merged main's
    opaque addressed session refs with #775's adoption bookkeeping. The central
    replace/forget path atomically updates all five identity stores; stable view
    ids prevent pane remounts during adoption.
14. `packages/workspace/src/app/front/WorkspaceShellCapabilitiesHost.tsx` —
    retained main's authoritative refresh capability and #775's detached-chat
    handoff. Detached views resolve the adopted opaque session key, and docking
    parses that key so addressed `agentTypeId` ownership is preserved.
15. `packages/workspace/src/app/front/__tests__/WorkspaceAgentFront.test.tsx` —
    retained all native-adoption, optimistic-prompt, hydration-guard, new-chat,
    addressed-collision, and legacy-collision tests, updating persistence
    assertions to main's v2 session-ref format.
16. `packages/workspace/src/app/front/__tests__/useWorkspaceShellCapabilitiesController.test.tsx`
    — retained the typed floating-session model and main's refresh-capability
    test.
17. `packages/workspace/src/app/server/createWorkspaceAgentServer.ts` — kept
    main's Agent Host/request-context wiring and restored explicit boolean
    normalization.
18. `packages/workspace/src/front/layout/plugin-tabs/AppLeftPane.tsx` — combined
    addressed session refs with stable adoption `viewId`, working-state
    continuity, live active-project sessions, and assistant-gated rename.
19. `packages/workspace/src/front/layout/plugin-tabs/AppLeftPaneSessionRow.tsx`
    — retained #775 inline rename/actions and main's structured addressed drag
    payload.
20. `packages/workspace/src/front/layout/plugin-tabs/__tests__/AppLeftPane.test.tsx`
    — retained both live-project/rename coverage and addressed-vs-legacy
    collision coverage.

Main extracted three route modules during the 133-commit merge. The native
capability was therefore also propagated narrowly through:

- `packages/agent/src/server/agentHostLegacyRouteOptions.ts`
- `packages/agent/src/server/agentHostLegacyRouteRuntime.ts`
- `packages/agent/src/server/agentHostLegacyRouteMount.ts`

The agent-playground opt-in moved to:

- `apps/agent-playground/src/server/agentHost.ts`

Independent review also exposed merge intersections in newly added main files.
They were repaired and covered in:

- `packages/agent/src/server/agent-host/legacyPiChatCompatibility.ts`
- `packages/agent/src/server/agent-host/sessionInventory.ts`
- `packages/agent/src/server/agent-host/buildAgentComposition.ts`
- `packages/agent/src/server/agent-host/__tests__/legacyAdmissionCompatibility.test.ts`
- `packages/agent/src/server/agent-host/__tests__/noBootSessionListing.test.ts`

## Required gates

The commands were first run exactly as requested after:

```text
export TMPDIR=/home/ubuntu/.cache/vitest-tmp
```

This sandbox cannot create that path. All three Vitest commands failed before
importing tests:

### `cd packages/agent && npx vitest run src/server src/core`

```text
Error: ENOENT: no such file or directory, mkdir '/home/ubuntu/.cache/vitest-tmp/Ol4vOZNehkEx5d1BE1sfM/ssr'

 Test Files  94 failed (94)
      Tests  no tests
Type Errors  no errors
```

### `cd packages/workspace && npx vitest run src/app/front src/front/layout`

```text
Error: ENOENT: no such file or directory, mkdir '/home/ubuntu/.cache/vitest-tmp/J7B-QuTFFVwwdrszF3_Ol/client'

 Test Files  12 failed (12)
      Tests  no tests
```

### `pnpm --filter full-app test`

```text
Error: ENOENT: no such file or directory, mkdir '/home/ubuntu/.cache/vitest-tmp/qktkhDi4MvDNa2Uao0MfE/ssr'

 Test Files  5 failed (5)
      Tests  no tests
```

### `pnpm lint:invariants`

Exit 0. Final output:

```text
[boring-sandbox invariant] PASS all boring-sandbox invariant checks completed

> boring-ui-v2@0.1.90 lint:workspace-plugin-invariants /home/ubuntu/projects/boring-ui-v2-775-pr811-final
> pnpm --filter @hachej/boring-workspace run lint:plugin-invariants

> @hachej/boring-workspace@0.1.90 lint:plugin-invariants /home/ubuntu/projects/boring-ui-v2-775-pr811-final/packages/workspace
> node ./scripts/check-plugin-invariants.mjs

[plugin-invariants] ok (418 source files scanned)
```

## Writable-TMPDIR proof

The same behavioral suites were rerun with `TMPDIR=/tmp`:

### Agent server/core

```text
 Test Files  11 failed | 82 passed | 1 skipped (94)
      Tests  30 failed | 911 passed | 13 skipped (954)
Type Errors  no errors
     Errors  9 errors
```

All 30 failures are sandbox/environment failures: localhost listeners are
blocked with `listen EPERM`, writes under `/home/ubuntu/.pi` are denied, and
process/package-provisioning fixtures consequently return empty output or 500s.
The #775-focused agent suites pass 23/23. Compatibility-wrapper and no-boot
native-inventory proof passes 11/11, including valid HTTP native start,
`retry: false` to `retry: true` replay, rename, enabled discovery, and disabled
non-discovery.

### Workspace front/layout

```text
 Test Files  12 passed (12)
      Tests  169 passed (169)
```

After the final prompt-ref cleanup, the focused native workspace tests also
report:

```text
 Test Files  1 passed (1)
      Tests  1 passed | 69 skipped (70)
```

That focused case is the addressed detached-view adoption/dock proof and asserts
that docking switches with both the adopted native id and `agentTypeId`.

### Full app

```text
 Test Files  5 passed (5)
      Tests  46 passed (46)
```

### Additional proof

- Agent TypeScript: exit 0.
- Workspace TypeScript: exit 0.
- Agent front/native focused tests: 143/143 passed.
- Core provisioning: 11/11 passed.
- Workspace server: 38/38 passed.
- boring-mcp verified-user binding: 12/12 passed.
- Marker scan: no `<<<<<<<`, `=======`, or `>>>>>>>` lines outside ignored
  dependency metadata.
- `git diff --check`: clean.

Known pre-existing results called out by the owner (`TS2321` in
`packages/agent/src/bin/boring-agent.ts` and agent-front React-patch environment
failures) were not exercised by the requested server/core-only Agent command.

## Review

Thermo-nuclear independent review initially found three merge-intersection
blockers:

1. the new Agent Host wrapper dropped native-first and rename methods;
2. native addressed inventory could not resolve adopted bare transcripts; and
3. detached docking lost addressed ownership.

All three were fixed and re-reviewed. Final verdict: no remaining P0/P1 issues
in the reviewed merge scope.
