# Skill resources playground checklist

Use the backend-free Workspace playground to review #970 and #971 together.
Authorization and invocation behavior is automated; manual review is limited to UI presentation.

## Automated gate

```bash
pnpm --filter workspace-playground test:e2e:skills
```

This must prove, through the real Workspace frontend and HTTP server:

- exact user, package, company, and duplicate-management catalog rows;
- browser-safe `{ filesystem, path }` resources with no `filePath` or host path;
- one Pi-authoritative invocation winner per name;
- composer discovery for user, package, and filesystem skills;
- fresh canonical file-route expansion with preserved arguments;
- write, delete, move, and mkdir denial for readonly resources;
- readonly enforcement for user `.agents` plus successful user writes outside it;
- revoked stale-command failure and post-reload catalog cleanup.

## Deterministic manual start

```bash
pnpm --filter workspace-playground dev:skills
```

The script resets a dedicated review workspace/session directory, enables scripted Pi, and enables the same `company_context` filesystem in both server and frontend. Open <http://localhost:5200/?fresh=1>.

To start with company skills denied instead:

```bash
pnpm --filter workspace-playground dev:skills:denied
```

## Expected skill identities

| Name | Filesystem | Path | Composer state |
|---|---|---|---|
| `workspace-review` | `user` | `.agents/skills/workspace-review/SKILL.md` | Invocable winner |
| `bi-dashboard-authoring` | `agent_resources` | `packages/@hachej/boring-bi-dashboard/skills/bi-dashboard-authoring/SKILL.md` | Invocable winner |
| `company-review` | `company_context` | `.agents/skills/company-review/SKILL.md` | Invocable winner while readable |
| `workspace-review` | `company_context` | `.agents/skills/workspace-review/SKILL.md` | Management-only duplicate |

A management-only row is not a policy denial. It is a readable duplicate that lost Pi's single-winner name resolution. A denied skill must disappear entirely.

## 1. Raw catalog

Inspect the unfiltered response:

```bash
curl --silent http://127.0.0.1:5210/api/v1/agent/skills | tee /tmp/skill-catalog.json | jq .
```

Verify:

- [ ] All four expected rows and exact resources are present.
- [ ] Exactly one `workspace-review` row is invocable.
- [ ] The `user` row is that winner.
- [ ] The company duplicate has `invocable: false`.
- [ ] No `filePath`, `node_modules`, `/home/`, or package installation path occurs in the raw JSON.

Path-leakage assertions apply to skill/resource APIs and their errors. `/api/v1/workspace/meta` is a development endpoint that intentionally reports its workspace root.

## 2. Skills UI semantics

Open **Skills** and verify:

- [ ] Invocable rows use `/name`; the duplicate row is labelled **Management source**.
- [ ] Each row opens the correct logical filesystem and relative path.
- [ ] All files opened from Skills use source-view mode, including the user skill.
- [ ] Package and company source views expose no save, rename, move, or delete controls.
- [ ] No duplicate React-key warning or host path appears in the browser console/DOM.

Skills source viewing does not establish workspace writability. Test an ordinary user file separately in **Files**; it must remain editable.

## 3. Composer and invocation

Open **New chat**, type `/`, and verify:

- [ ] `/workspace-review`, `/bi-dashboard-authoring`, and `/company-review` appear.
- [ ] Only one `/workspace-review` command appears.
- [ ] The management-only company duplicate never appears as a command.
- [ ] Submitting `/company-review policy.md` succeeds and preserves `policy.md` as the user request.
- [ ] Network inspection shows a fresh `GET /api/v1/files` for the exact `company_context` `SKILL.md` resource.
- [ ] Submitting `/workspace-review ...` uses the user winner even after opening the company management row.

## 4. Readonly and confinement

For `user/.agents`, `agent_resources`, and `company_context`:

- [ ] Read and stat operations succeed for authorized resources.
- [ ] Write, delete, move, and mkdir return HTTP 403 with a readonly error.
- [ ] No partial file or directory is created after denial.
- [ ] Traversal, absolute paths, adjacent package files, and symlink escapes fail closed without revealing host paths.
- [ ] Equivalent operations outside `user/.agents` continue to succeed.

These are automated gates; manual curl testing is optional.

## 5. Revocation and stale commands

While `dev:skills` is running, revoke company skill reads without restarting the browser:

```bash
curl --silent --request POST \
  --header 'content-type: application/json' \
  --data '{"readable":false}' \
  http://127.0.0.1:5210/api/v1/playground/company-skills | jq .
```

Verify:

- [ ] A composer command registered before revocation fails with `Skill is no longer available.`
- [ ] The failed submission does not reach Pi.
- [ ] After reload, `/company-review` is absent from the composer.
- [ ] After **Refresh skills**, both company skill rows are absent from Skills.
- [ ] User and package commands remain available.
- [ ] `company_context/policy.md` remains readable; denial is scoped to `.agents/skills`.

Restore access:

```bash
curl --silent --request POST \
  --header 'content-type: application/json' \
  --data '{"readable":true}' \
  http://127.0.0.1:5210/api/v1/playground/company-skills | jq .
```

Reload and verify the unique company skill returns without changing the duplicate winner.

## 6. Refresh and cache stability

- [ ] Ordinary catalog fetch, `?refresh=1`, browser reload, and plugin reload preserve the same winner.
- [ ] Revoked rows are not restored from native/shared caches.
- [ ] Repeated refreshes do not duplicate commands or rows.
- [ ] Equivalent request-header object identities do not trigger a request loop.
- [ ] No stale filesystem command can bypass the fresh authorized file read.
