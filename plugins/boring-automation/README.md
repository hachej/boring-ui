# @hachej/boring-automation

Trusted Boring workspace plugin for scheduled prompt automations.

## Capabilities

The UI, HTTP routes, and trusted `boring_automation` Pi tool manage the same workspace-scoped automation records. Supported tool operations are:

| Operation | Behavior |
| --- | --- |
| `list` | List automation metadata in the active workspace. Optional `limit` is 1–100 (default 50). |
| `get` | Read one automation plus its canonical prompt. |
| `create` | Create title, enabled state, five-field cron, IANA timezone, model, effort (`thinkingLevel`), and prompt. |
| `update` | Update any create-time field, including the canonical prompt. At least one field is required. |
| `pause` / `resume` | Set `enabled` false/true. Pause affects future scheduled runs only. |
| `run` | Run the stored canonical prompt, model, and effort now through the existing workspace agent runtime. |
| `list_runs` | List safe run summaries. Optional `limit` is 1–100 (default 50). |
| `delete` | Remove automation metadata, matching the UI delete behavior. |

`delete` uses the same store operation as the UI. Local file mode removes active metadata while leaving prompt/run files. Hosted Postgres mode soft-deletes the automation: it disappears from active list/get/update/run and due evaluation while preserving the stored prompt and run rows. Existing Pi sessions are not deleted in either mode. A paused automation can still be run manually. A finalized failed or cancelled run is returned as a run result; validation, missing-context, and unavailable-executor failures are tool errors.

Tool results are bounded for agent context safety. Lists return at most 100 records. `get` returns at most 16,384 JavaScript characters of prompt text and includes `characterCount` and `truncated`. Run summaries omit prompt/model snapshots, and public errors use stable sanitized codes/messages.

## Scope and authorization

`boring_automation` is a trusted, boot-time server tool, not a runtime `.pi/extensions` tool. The model cannot provide a workspace ID, user ID, owner ID, request, or filesystem path.

- CLI/folder mode requires the host-derived active workspace and uses the trusted fixed local actor.
- Hosted mode requires both the host-derived workspace and authenticated user, and binds every operation to an actor-scoped Postgres store.
- Missing host context fails closed before store or executor resolution.
- Manual tool runs use the existing `WorkspaceAgentDispatcherResolver`, so child sessions retain normal workspace/actor ownership and appear in regular Pi session history. The core agent facade supports a second child session dispatch while the parent tool turn remains active; this nested-session behavior has focused integration coverage.

Cross-workspace or cross-owner IDs are returned as not found. Runtime plugin reload cannot install or change this server tool.

## Model compatibility

The agent tool requires explicit `provider:model-id` syntax for model-bearing `create` and `update` calls, for example `anthropic:claude-sonnet`.

Existing UI and HTTP routes retain compatibility with legacy unqualified saved model values. Those values remain editable but fail safely when run until corrected. The tool does not silently guess a provider.

## Local and hosted execution

Local CLI support includes:

- workspace-scoped file-backed metadata and canonical Markdown prompts;
- automation and prompt UI/routes;
- executor-owned **Run now** through the host's existing workspace runtime;
- run history linked to normal interactive Pi sessions;
- partial live usage totals when providers emit usage events;
- deterministic current-minute cron evaluation invoked through the loopback due endpoint.

Scheduling has no background timer. User-owned cron/systemd may invoke `POST /api/v1/boring-automation/due` once per minute while the CLI server is running. Missed minutes are not backfilled.

Hosted persistence and creator-scoped execution are available in full-app. The deployment migration callback is `runBoringAutomationMigrations`. Configure `BORING_AUTOMATION_TRIGGER_TOKEN` and have the platform scheduler invoke `POST /api/v1/boring-automation/due/hosted` with `Authorization: Bearer <token>`. The endpoint re-checks each creator and fails closed when authorization is lost.

## Enable gate and rollback

The trusted server plugin enables the agent tool by default. Host composition can set `agentToolEnabled: false` at boot to remove only `boring_automation`; UI, HTTP routes, stored automations, prompts, runs, and sessions remain available. Server tool changes and gate changes require a host restart; `/reload` only affects runtime plugin resources.

Rollback is capability-only: disable/remove the tool contribution and restart. No data migration or deletion is required.

## Deterministic UI review

`@hachej/boring-automation/testing` exposes the product panel and client provider
for private repository fixture hosts. Run the registered desktop/mobile pane and
editor review with:

```bash
pnpm --filter @hachej/boring-ui-review-tools ui:review -- review automation-pane-popover --critic=fixture
```

## Manual proof

1. Start/restart the trusted host and open workspace A.
2. Ask the agent to use `boring_automation` to create an automation with a valid five-field cron, IANA timezone, explicit `provider:model-id`, effort, and prompt.
3. Open **Automations** and verify the same record and prompt appear in the UI.
4. Ask the agent to list/get it, update its prompt or schedule, pause it, and resume it; verify each change in the UI.
5. Ask the agent to run it. Verify the run appears in history and its normal Pi session opens and accepts messages.
6. Ask the agent to list recent runs, then delete the automation. Verify it disappears from active UI/tool operations while local prompt/run files or hosted tombstoned prompt/run rows remain; existing Pi sessions remain.
7. Switch to workspace B (or another hosted actor) and verify workspace A's automation cannot be listed or addressed.
