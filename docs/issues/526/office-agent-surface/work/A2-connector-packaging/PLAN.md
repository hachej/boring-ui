# A2 — Connector Packaging Plan

## Today / Delta

Today, the spike connector exists outside boring-ui at `/home/ubuntu/projects/ext-pi-for-excel-test/boring-connector/boring-connector.mjs`. It registers four tools, calls boring-ui through pi's mediated `api.http.fetch`, injects `x-boring-workspace-id`, and relies on host-injected connection auth (`/home/ubuntu/projects/ext-pi-for-excel-test/boring-connector/boring-connector.mjs:230-410`). The spike runtime test passed and asserted authorization header injection, workspace header injection, tool registration, and cloud-ref fields (`/home/ubuntu/projects/ext-pi-for-excel-test/INTEGRATION-SPIKE.md:150-190`).

Delta: promote the connector into boring-ui under `integrations/pi-for-excel/` with package docs, templates, and CI-runnable tests. The connector remains one reviewable `.mjs` file.

## Deliverables

- `integrations/pi-for-excel/boring-connector.mjs`.
- Connection-bundle template with `allowedHosts`, base URL, workspace ID, and host-injected auth.
- Install/runbook doc covering sideload manifest, remote-extension opt-in, private HTTPS URL install, and install-code fallback.
- A small Vitest package that ports the spike runtime test.
- Reference copy of the spike connector in this plan pack.

## Packaging Decisions

- Add `integrations/*` to `pnpm-workspace.yaml` only so the connector tests can run in CI.
- Do not compile the connector into a bundle during A2. Review the shipped `.mjs` directly.
- Keep secrets out of default templates. Use placeholders only.
- Keep auth in pi's connection layer. The connector reads config and names a connection; it does not embed a bearer token.
- Use the boring-sharepoint cloud-ref schema for `.xlsx.cloud.json`. PowerPoint ref saving requires the explicit B2 Office-ref generalization bead.

**Amendment (2026-07-06):** `integrations/pi-for-excel/` is the single source of truth for the Boring tool pack. Refactor tool registration into a `BORING_TOOLS` descriptor list (`{name, description, parameters, execute}`) so the same descriptors serve both the remote-install `.mjs` and the wrapper's bundled `builtin.boring` first-party extension (#551 Axis 1). Adding a tool = one descriptor + tests; a fixture asserts every descriptor registers exactly once and declares `additionalProperties: false`.

## Exit Criteria

- A fresh agent can run the connector tests with one pnpm command.
- The connector sends `Authorization` through host-injected auth and `x-boring-workspace-id` explicitly.
- The runbook explains how to sideload the add-in and install the extension from a private HTTPS URL.
- The runbook warns that company use must self-host the taskpane bundle and connector.
