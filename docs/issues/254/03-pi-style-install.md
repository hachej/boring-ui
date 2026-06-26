# 03 — Pi package-source install/list/remove/update

## Goal

Add external plugin installation using the same package-source model as Pi.

A boring plugin package is a Pi package: boring reads `package.json#boring`, Pi reads `package.json#pi`, and Pi no-ops when a package has no `pi` resources.

```txt
boring-ui-plugin install <source> = trusted local code, enabled by default
```

No permission prompts/grants in CLI/local MVP.

## Commands

Mirror Pi package-source commands. Implementation lives in `boring-ui-plugin`; top-level `boring-ui plugin ...` may call the same handlers.

```bash
boring-ui-plugin install npm:@boring-plugins/email-client
boring-ui-plugin install git:github.com/user/email-client@v1
boring-ui-plugin install https://github.com/user/email-client
boring-ui-plugin install ./plugins/email-client
boring-ui-plugin install /absolute/path/to/email-client

boring-ui-plugin remove npm:@boring-plugins/email-client
boring-ui-plugin list [--json]

boring-ui plugin install ./plugins/email-client   # facade/reuse, if exposed
```

## Scope

Mirror Pi scope:

```bash
boring-ui-plugin install <source>       # global/user install by default
boring-ui-plugin install -l <source>    # workspace-local/project install
boring-ui-plugin install --local <source>
```

Install output must say scope clearly.

Global example:

```txt
Installed globally: ~/.pi/agent/npm/@boring-plugins/email-client
This plugin will load in all boring-ui CLI workspaces.
Run with -l/--local to install only in the current workspace.
```

Local example:

```txt
Installed for this workspace: <workspace>/.pi/npm/@boring-plugins/email-client
```

## Roots

Global/user:

```txt
~/.pi/agent/npm/
~/.pi/agent/git/
~/.pi/agent/extensions/
```

Workspace-local/project:

```txt
<workspace>/.pi/npm/
<workspace>/.pi/git/
<workspace>/.pi/extensions/
```

## Collision rule

```txt
workspace-local plugin wins over global plugin with same id
```

This must be explicit in discovery/source ordering and tested.

## Source behavior

### npm

- Install into scope-specific npm root.
- Delegate to configured package manager like Pi where possible.
- Dependencies install through package manager.
- Versioned specs are pinned.

### git / URL

- Clone into scope-specific git root.
- Support refs (`@v1`, tag, commit).
- Run dependency install if `package.json` exists, like Pi.
- Pinned refs should not silently move on update.

### local path

Mirror Pi first:

- local path is referenced, not copied;
- relative path resolves against settings/scope file;
- no dependency install unless user already did it;
- copy/link modes can come later if needed.

## Boring activation

After install:

1. resolve package root;
2. read `package.json`;
3. validate Boring manifest;
4. derive plugin id from package name;
5. write/update the Pi package source entry for the selected scope;
6. make boring discovery read the same Pi package source roots and scan `package.json#boring`;
7. make Pi resource loading read `package.json#pi` from the same package roots;
8. run `verify-plugin` if applicable;
9. run `test-plugin` if UI URL is known and user asks/flag is set;
10. tell user to run `/reload` or trigger reload when safe.

No separate `.pi/boring-plugin-sources.json` registry. Do not duplicate local plugin source trees into `.pi/extensions`; local paths remain editable source roots.

MVP can keep reload user-driven to match current plugin workflow.

## Security wording

For npm/git/URL:

```txt
Security: Boring plugins run as trusted local code in CLI mode. Review third-party source before installing.
```

No permission grants in CLI/local MVP. Hosted/cloud policy can add grants later.

## Workspaces mode

Global plugin:

- visible to all CLI workspaces;
- must not bypass workspace request scoping.

Workspace-local plugin:

- visible only for that workspace;
- must not activate in another workspace.

Gateway calls in workspaces mode must check workspace id/header using the same policy as adjacent workspace APIs.

## Tests

Required:

- global install appears in two workspaces;
- local install appears only in that workspace;
- local shadows global same-id plugin;
- list shows scope/source/id;
- remove global does not remove local;
- remove local does not remove global;
- npm/git/local source parsing matches Pi-style examples;
- third-party warning prints for npm/git/URL;
- install validates Boring manifest before activation;
- a package with only `package.json#boring` and no `package.json#pi` is valid and causes Pi to no-op;
- installed package source appears in boring `/api/v1/agent-plugins` after `/reload`;
- no custom boring source registry is created.
