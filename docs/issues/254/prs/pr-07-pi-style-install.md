# PR 07 — Pi package-source install/list/remove/update

## Goal

Add external package installation UX after runtime backend MVP works with existing plugin roots.

Boring plugin packages are Pi packages: boring reads `package.json#boring`, Pi reads `package.json#pi`, and Pi no-ops for packages with no `pi` resources.

## Scope

`boring-ui-plugin` implementation, optional top-level `boring-ui plugin ...` facade, Pi-style trust and scopes.

## Commands

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

## Scope

- Default: global/user install.
- `-l` / `--local`: workspace-local install.

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

## Behavior

- Install = trusted + enabled.
- No permission prompts/grants in CLI MVP.
- Print security warning for npm/git/URL sources.
- Validate Boring manifest before activation.
- Write/update Pi package source settings; do not create `.pi/boring-plugin-sources.json`.
- Reference local paths; do not copy/symlink local source into `.pi/extensions`.
- Run `verify-plugin` when applicable.
- Optionally run `test-plugin` when UI URL known.

## Non-goals

- No hosted/cloud permission system.
- No marketplace UI.
- No bwrap worker.

## Tests

- npm/git/local install works globally.
- `-l/--local` install works workspace-only.
- Workspace-local shadows global same-id plugin.
- `list` shows scope/source/id.
- `remove` respects scope.
- Third-party warning prints for npm/git/URL.
- Package with `boring` but no `pi` resources is valid.
- Installed package appears in `/api/v1/agent-plugins` after `/reload`.
- No custom boring source registry is created.

## Acceptance

- User can install external boring plugin packages as Pi package sources, globally or per workspace.
