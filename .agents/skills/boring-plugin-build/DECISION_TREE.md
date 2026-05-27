# Boring Plugin Build — Decision Tree

## First question

Is this plugin part of a shipped app, or just local iteration?

### If local iteration

Use runtime/generated plugin:

- location: `.pi/extensions/<name>/`
- reload path: `/reload`
- backend rule: no trusted `boring.server`
- best for: rapid UI/agent iteration

### If shipped app

Use app/internal trusted package:

- location: app-local plugin package or `plugins/<name>/`
- registration: `package.json#boring.defaultPluginPackages` and/or static front composition
- backend rule: `boring.server` allowed
- best for: real app features, trusted routes, trusted tools

## Second question

Does it contribute providers or bindings?

### If yes

- statically compose it in the front shell
- do not rely only on dynamic package discovery

### If no

- package discovery is often enough for panel/command/catalog/surface-resolver plugins

## Third question

Does it need trusted backend routes or tools?

### If yes

- it is not a pure runtime plugin path
- use app/internal trusted package
- restart/redeploy after server changes

### If no

- runtime plugin is still viable

## Fourth question

Is it app-specific or reusable?

### If app-specific

- keep it near the app

### If reusable across apps

- consider `plugins/<name>/`

## Final rule

If unsure, say so explicitly before writing files. Plugin shape is the load-bearing decision.
