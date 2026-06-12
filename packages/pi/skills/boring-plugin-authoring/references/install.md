# Installing an existing or published plugin (not authoring a new one)

If the user wants to **add a plugin that already exists** — a published npm package, a
git repo, or a local package — rather than write a new one, do NOT scaffold and do NOT
run a bare `npm install`. Use the `boring-ui-plugin` install command via the bash tool:

```bash
boring-ui-plugin install npm:@scope/plugin            # published npm package
boring-ui-plugin install git:github.com/owner/repo    # git repo (supports @ref)
boring-ui-plugin install github:owner/repo
boring-ui-plugin install ./path/to/plugin             # local package
boring-ui-plugin install npm:@scope/plugin --global   # all workspaces (default: this workspace)
boring-ui-plugin list [--json]                        # show installed plugin sources
boring-ui-plugin remove <id-or-source>                # remove one
```

This registers the plugin as a Pi package source in `<workspace>/.pi/settings.json`
(`packages`) and installs its dependencies. A bare `npm install <package>` only drops the
package into `node_modules` without registering it, so it will **not** load. After
installing, tell the user to run `/reload` (a plugin that ships a `boring.server` backend
also needs the workspace process restarted).
