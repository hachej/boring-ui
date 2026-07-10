# @hachej/boring-automation

Trusted Boring workspace plugin for scheduled prompt automations.

Current local CLI support includes:

- single-workspace file-backed automation metadata and canonical Markdown prompts;
- automation and prompt management UI/routes;
- executor-owned manual **Run now** operations through the host's existing workspace agent runtime;
- read-only run history linked to normal Pi sessions;
- partial live usage totals when the provider emits usage events.

Executable model values use explicit `provider:model-id` syntax. Legacy unqualified values remain editable but fail safely when run until corrected.

Manual execution is currently composed only for the trusted local CLI folder mode. Hosted actor policy, hosted persistence, due scheduling, and external triggers remain intentionally unavailable pending later issue #590 slices.
