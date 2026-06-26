# CLI/local runtime plugins — implementation plan

Read first: [context.md](./context.md).

This plan is intentionally reduced to **three PRs**. Each PR has a dedicated detailed plan under [prs/](./prs/).

## PR 01 — Foundation

Detailed plan: [prs/01-foundation.md](./prs/01-foundation.md)

Goal: prepare the codebase without executing runtime backend handlers.

Includes:

- one plugin-facing `boring.server` manifest field;
- first-class internal/external plugin source metadata;
- obsolete `/api/boring.reload` removal;
- shared jiti fresh-import helper.

Acceptance:

- internal vs external classification is explicit, not path-inferred;
- obsolete `/api/boring.reload` route is removed;
- existing jiti behavior is reused through one helper;
- no runtime backend handlers execute yet.

## PR 02 — Server runtime backend MVP

Detailed plan: [prs/02-server-runtime-mvp.md](./prs/02-server-runtime-mvp.md)

Goal: make external CLI/local `boring.server` entries work from existing plugin roots like `.pi/extensions`.

Pipeline:

```txt
jiti import -> capture exact routes -> atomic registry swap -> gateway dispatch
```

Includes:

- plain default-export runtime server module contract;
- optional `@hachej/boring-workspace/runtime-server` helper/types for package authors;
- exact-match router capture;
- runtime backend loader and registry;
- stable gateway at `/api/v1/plugins/:pluginId/*`;
- backend reload integration;
- backend diagnostics in reload responses.

Non-goals:

- no install command;
- no npm/git/local package management;
- no permission prompts;
- no bwrap/remote sandbox;
- no route params/wildcards.

Acceptance:

- existing `.pi/extensions/<id>` plugin with `boring.server` can hot-reload backend handlers in CLI/local mode.

## PR 03 — Pi package-source install/list/remove MVP

Detailed plan: [prs/03-cli-install-and-verification.md](./prs/03-cli-install-and-verification.md)

Goal: add user-facing install/list/remove after server MVP works.

Includes:

- package-source install flow matching Pi: npm/git install deps in installed/cloned plugin dirs, local paths are referenced without auto-installing deps, and `/reload` stays dependency-free;
- `boring-ui-plugin install <source>` implementation, with optional `boring-ui plugin ...` facade/reuse;
- global/user scope and `-l/--local` workspace scope using Pi package source settings;
- npm/git/URL/local path sources;
- `list` and `remove`;
- manifest validation before activation;
- boring discovery scans the same Pi package roots for `package.json#boring`;
- Pi scans the same package roots for `package.json#pi` and no-ops when absent;
- no separate `.pi/boring-plugin-sources.json` registry;
- security warning for third-party sources.

Acceptance:

- user can install, list, and remove external boring plugins as Pi package sources;
- workspace-local shadows global same-id plugin;
- installed package appears in `/api/v1/agent-plugins` after `/reload`;
- package with no `pi` resources does not break Pi resource loading;
- installed plugin can use PR 02 server runtime after `/reload`.

Follow-up:

- `update`;
- backend health support in `test-plugin`.

## Deferred

- hosted/cloud plugin support;
- permission grants/marketplace policy;
- bwrap/local-sandbox backend workers;
- dynamic provider/binding hot mount;
- route params/wildcards;
- rich workspace facade for backend handlers.
