# @hachej/boring-automation

Trusted Boring workspace plugin for scheduled prompt automations.

Current local CLI support includes:

- single-workspace file-backed automation metadata and canonical Markdown prompts;
- automation and prompt management UI/routes;
- executor-owned manual **Run now** operations through the host's existing workspace agent runtime;
- read-only run history linked to normal Pi sessions;
- partial live usage totals when the provider emits usage events;
- deterministic current-minute cron evaluation invoked through the local loopback due endpoint.

Executable model values use explicit `provider:model-id` syntax. Legacy unqualified values remain editable but fail safely when run until corrected.

Execution is currently composed only for trusted local CLI folder mode. Scheduling has no background timer: user-owned cron/systemd may invoke `POST /api/v1/boring-automation/due` once per minute while the CLI server is running. Missed minutes are not backfilled. Hosted actor policy, hosted persistence, and hosted triggers remain intentionally unavailable pending later issue #590 slices.
