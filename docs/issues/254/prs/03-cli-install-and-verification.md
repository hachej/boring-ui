# PR 03 — Pi-package install/list/remove MVP

## Goal

After the server MVP works from existing plugin roots, add the smallest useful user-facing install flow.

Design update after PR 02/03 playground validation: a boring plugin package is also a Pi package. Install/list/remove must manage Pi package sources and boring must discover `package.json#boring` from those same package roots. Do **not** create a parallel boring-only source registry.

## Scope

Add Pi-style package source install, list, and remove commands for boring plugin packages.

Ownership split:

- `boring-ui-plugin` owns the implementation because it is the slim workspace/agent-facing plugin CLI already provisioned into editable workspaces.
- top-level `boring-ui plugin ...` may expose/reuse the same handlers/options as a human-facing facade.
- `/reload` and `verify` must never repair/install missing dependencies for an already-authored plugin.

Installed sources are Pi package sources. Boring consumes the same package roots by reading `package.json#boring`; Pi consumes `package.json#pi`. If a package has no `pi` resources, Pi no-ops (verified with `DefaultResourceLoader`: zero extensions, no prompt append).

Dependency install rule mirrors Pi:

```txt
npm/git installs install package dependencies in the installed/cloned package dir.
local-path installs reference the local package and do not auto-install dependencies.
Never install dependencies in the workspace root or app root.
```

Internal/app plugins are different: they are composed by the app and their dependencies are owned by the app/monorepo package manager, not by `boring-ui-plugin install`.

`update` and backend self-test are follow-ups unless implementation turns out trivial and does not expand the PR.

## Commands

Required:

```bash
boring-ui-plugin install npm:@boring-plugins/email-client
boring-ui-plugin install git:github.com/user/email-client@v1
boring-ui-plugin install https://github.com/user/email-client
boring-ui-plugin install ./local-plugin
boring-ui-plugin install -l ./local-plugin

boring-ui-plugin list [--json]
boring-ui-plugin remove <source-or-id>

boring-ui plugin install ./local-plugin   # facade/reuse, if exposed
```

Deferred/stretch:

```bash
boring-ui-plugin update [source-or-id]
```

## Trust model

CLI/local install mirrors Pi:

```txt
boring-ui-plugin install <source> = trusted local code, enabled by default
```

No permission prompts/grants in this PR.

Print warning for npm/git/URL sources:

```txt
Security: Boring plugins run as trusted local code in CLI mode. Review third-party source before installing.
```

## Scope behavior

Default is global/user install.

```bash
boring-ui-plugin install <source>
```

Workspace-local install:

```bash
boring-ui-plugin install -l <source>
boring-ui-plugin install --local <source>
```

Roots mirror Pi:

```txt
Global:
  ~/.pi/agent/npm
  ~/.pi/agent/git
  ~/.pi/agent/extensions

Workspace:
  <workspace>/.pi/npm
  <workspace>/.pi/git
  <workspace>/.pi/extensions
```

Collision rule:

```txt
workspace-local plugin wins over global plugin with same id
```

## Source behavior

### npm

- Install into scope-specific package root.
- Use package manager behavior close to Pi.
- Dependencies are installed in the installed package directory/package-manager root for that plugin source, never workspace/app root.
- Validate Boring manifest before activation.
- `/reload` must never install missing packages.

### git / URL

- Clone into scope-specific git root.
- Support refs/tags/commits where practical.
- Run dependency install in the cloned plugin package directory if `package.json` exists, like Pi.
- Validate Boring manifest before activation after dependencies are present enough for verification.
- Pinned refs should not silently move on future update.

### local path

Mirror Pi strictly and align with PR #166:

- reference local path;
- do not copy;
- do not auto-install dependencies;
- run verification against that plugin directory;
- if dependencies are missing, print the exact command to run in the plugin directory.

Example diagnostic:

```txt
Missing dependency: recharts
Run: cd ./local-plugin && npm install
```

Important distinction: local-path install records/references the plugin source. It does not mutate that source's dependencies. Dependency install must not happen implicitly during `/reload` or normal verification either.

## Verification

After install:

1. resolve package root;
2. read `package.json`;
3. validate Boring manifest;
4. derive plugin id from package name;
5. add package source to Pi's selected scope/package source settings;
6. make boring discovery read those same Pi package roots for `package.json#boring`;
7. run `verify-plugin` when applicable;
8. tell user to run `/reload` or trigger reload only when safe.

Do not require Playwright `test-plugin` in this PR. It can remain a manual command or follow-up integration.

Dependency install is allowed during `boring-ui-plugin install npm:<pkg>` and `boring-ui-plugin install git:<repo>` for the installed/cloned package. Local-path install does not auto-install dependencies. Do not add dependency-install behavior to `/reload`; PR #166 intentionally keeps reload as reload-only.

## Follow-ups

### Update command

Add after install/list/remove works:

```bash
boring-ui-plugin update [source-or-id]
```

### Backend self-test polish

Support optional backend health declaration later:

```jsonc
{
  "boring": {
    "server": "server/index.ts",
    "health": { "path": "/health" }
  }
}
```

`test-plugin` can later call plugin-owned gateway path:

```txt
/api/v1/plugins/:pluginId/health
```

Host metadata health remains separate if/when added:

```txt
/api/v1/agent-plugins/:pluginId/health
```

## Non-goals

- No `update` unless trivial.
- No backend self-test integration.
- No hosted/cloud permission system.
- No marketplace UI.
- No bwrap worker.
- No generic endpoint crawler.
- No deep backend interaction testing.

## Tests

- npm/git/local install works globally.
- `-l/--local` install works workspace-only.
- Workspace-local shadows global same-id plugin.
- `list` shows scope/source/id.
- `remove` respects scope.
- Third-party warning prints for npm/git/URL.
- Manifest validation happens before activation.
- npm/git/URL installs leave declared package dependencies present.
- Local-path install references the local package through Pi package source settings without auto-installing dependencies and prints clear install hints if dependencies are missing.
- Any dependency install that does happen runs in the installed/cloned plugin package directory, never workspace/app root.
- Missing plugin-local deps are never installed during reload.
- No `.pi/boring-plugin-sources.json` or other bespoke boring registry is introduced; the package source registry is Pi-owned/compatible.
- Installed plugin with only `package.json#boring` and no `package.json#pi` is valid: Pi no-ops and boring loads the UI/backend surfaces.
- Installed plugin can use PR 02 runtime backend after `/reload`.

## Acceptance

- User can install, list, and remove external boring plugins as Pi package sources.
- Boring discovers installed Pi package sources and loads their `package.json#boring` surfaces after `/reload`.
- Pi consumes any `package.json#pi` resources from the same packages and no-ops for packages without `pi`.
- Installed plugin can be verified and, after reload, use the server MVP from PR 02.
- `update` and backend self-test are not required for this PR to ship.
