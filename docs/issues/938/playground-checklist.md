# Skill resources playground checklist

Use the backend-free Workspace playground to review #970 and #971 together.

## Start with all skill sources readable

```bash
pnpm --filter workspace-playground dev:skills
```

Open <http://localhost:5200>. The API listens on `127.0.0.1:5210`.

## Catalog and resource identity

Open **Skills** from the app navigation and verify:

- `/workspace-review` is invocable and opens from filesystem `user`.
- `/bi-dashboard-authoring` is invocable and opens from `agent_resources`.
- `/company-review` is invocable and opens from `company_context`.
- `workspace-review` also has a non-invocable **Management source** row from `company_context`; the `user` source remains the slash-command winner.
- No row or network response exposes an absolute package, home, or `node_modules` path.

API inspection:

```bash
curl --silent http://127.0.0.1:5210/api/v1/agent/skills | jq '.skills[] | {
  name, invocable, invocation, source, resource
}'
```

Expected browser-safe resources include:

```text
user             .agents/skills/workspace-review/SKILL.md
agent_resources  packages/@hachej/boring-bi-dashboard/skills/bi-dashboard-authoring/SKILL.md
company_context  .agents/skills/company-review/SKILL.md
```

## Open and mutation behavior

- Open the workspace skill: normal workspace editing remains available.
- Open the package skill: it is view-only; save, rename, move, and delete must not be available.
- Open the company skill and `policy.md`: both are view-only.
- Relative references from `company-review` resolve inside `company_context`, not the user workspace.
- Attempted package/company mutations through the UI or file API return a readonly/forbidden response.

## Composer behavior

In a new chat, enter `/` and verify:

- `workspace-review`, `bi-dashboard-authoring`, and `company-review` appear.
- Only one invocable `workspace-review` command appears.
- Selecting `/company-review policy.md` loads the skill through the authorized file route and preserves the typed argument.
- Native/package skills continue through normal Pi invocation.

## Denied-folder behavior

Stop the playground and restart with company skill access denied:

```bash
pnpm --filter workspace-playground dev:skills:denied
```

Verify:

- `company-review` disappears from both Skills and the composer.
- The company `workspace-review` management source disappears.
- The user `workspace-review` and package `bi-dashboard-authoring` remain available.
- Direct reads fail:

```bash
curl --include --get http://127.0.0.1:5210/api/v1/files \
  --data-urlencode filesystem=company_context \
  --data-urlencode path=.agents/skills/company-review/SKILL.md
```

- `company_context/policy.md` remains readable; only `.agents/skills` is denied.
- Refreshing Skills or reloading plugins does not restore denied rows.

## Reload and leakage checks

- Use **Refresh skills** after each mode change.
- Reload the browser and confirm the same catalog.
- Inspect `/api/v1/agent/skills` and failed file responses for host-path leakage.
- Confirm duplicate resource rows have stable rendering without React key warnings.
