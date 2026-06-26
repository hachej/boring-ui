# 04c — Runtime/Sandbox Preboot Endpoint

## Purpose

After explicit user intent to open a project/session, start runtime/sandbox preparation in the background so tools/files are likely ready by the time the user needs them.

Depends on:

- 03a persistent shell for explicit open flow;
- 04a typed open-session handoff for explicit session opens;
- 04b no-boot transcript/state if testing that chat render does not await preboot. Without 04b, this sub-plan should limit validation to the preboot call itself.

## Review budget

Target non-test/non-doc added LOC: **< 2,500**.
Hard cap for PR review: **< 15,000** non-test/non-doc added LOC.

## Scope

- Add an honest idempotent preboot trigger.
- Call it after explicit open intent.
- Do not call it from project expansion/browsing.
- Do not block chat UI render on preboot.

## Endpoint sketch

`POST /api/v1/agent/runtime/preboot`

Request:

```json
{ "reason": "open-project" | "open-session" }
```

Workspace scoping:

- `x-boring-workspace-id` / existing request workspace resolver.

Response:

```ts
type RuntimePrebootResponse = {
  status: 'started' | 'already-starting' | 'already-ready' | 'not-supported'
}
```

Behavior:

- idempotent per workspace;
- if provisioning already in progress, return `already-starting`;
- if ready, return `already-ready`;
- starts runtime binding/provisioning in background;
- does not send chat messages or start agent turns;
- logs failures but exposes stable error envelope if request itself fails.

## Lifecycle

- Rapid clicking across projects should not create duplicate provisioning jobs for the same workspace.
- If a prebooted workspace is evicted before visible, runtime cleanup follows existing runtime lifecycle/TTL. If no cleanup exists, document that preboot uses existing runtime TTL and do not invent ad hoc kill logic.

## Tests / acceptance

- Endpoint starts provisioning once.
- Repeated calls are idempotent.
- Explicit session/project open calls endpoint.
- Project expand/browse does not call endpoint.
- Chat render path test proves UI does not await preboot promise (requires 04b).
- Preboot start/end/status/duration are measured or reported separately from chat render/UI mount.
- Stable error shape for failures.

## Out of scope

- First tool inline wait UI (04d).
- No-boot transcript (04b).

## Risks

- Runtime provisioning may be expensive. Only trigger on explicit open intent.
- If existing provisioning path has side effects that assume a chat request, do not reuse blindly; create a safe readiness/prewarm path.
