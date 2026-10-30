# How a kit release reaches apps

Owner: boring-ui. Target from [TARGET section 5](https://github.com/hachej/boring-factory/blob/main/docs/TARGET.md): no platform code in apps; the kit is a versioned npm dependency picked up at the app's next build. Publishing itself is [NPM-RELEASE](NPM-RELEASE.md).

## Today

Two routes, and only the first matches the target:

1. **npm:** apps already pin `@hachej/boring-ui-kit` and `@hachej/boring-agent` as exact dependencies (Coach Max: `0.4.34`).
2. **Copied source:** registry blocks are installed as source into the app's `web/src/components/`, and `platform.json` records their hashes (Coach Max and Studio: over 200 files). A fix here needs the chain: kit release, Factory kit-train and `agents-rN` line, `build/publish-vendor.mjs`, sync rerun, gate approval.

The agent runtime and the compiled kit already take route 1. Route 2 is what the chain exists for.

## Target path

1. A kit PR merges. A release publishes all five packages to npm ([NPM-RELEASE](NPM-RELEASE.md)).
2. An app picks the version up at its next build, by bumping its pin. A bump is an ordinary app change: the app's checks, the watch and rollback are the safety.
3. Nothing else: no vendor upload, sync or gate step for kit code.

A bump reaches an app when its master bumps it, or when a Factory wake opens the bump. Choosing between them is the Factory's: this document needs only that one of them happens.

## What has to change first, in the kit

Route 2 can't go until blocks can be imported rather than copied. A block has to become a package entry on top of the app's shadcn components, as the file tree already is: logic and view in `@hachej/boring-ui-kit/file-tree-view`, with `registry/file-tree/file-tree.tsx` only passing the app's components in.

- Item by item, most-changed first: `pi-chat`, `app-shell`, `pm-panel`, `task-board`.
- A thin registry item stays per block where an app must supply its own `components/ui`. Generated shadcn files stay the app's.
- Package exports and registry items aren't removed without a fresh boring-factory consumer search (AGENTS.md).

Until an item has moved, its fix still needs route 2. So the two routes run side by side during the move, and the chain goes last.

## What is deleted

**In boring-ui, when the last app stops copying a block:** the block's source in `registry/`, leaving the thin item if one is needed; `public/r/` for that item; and the `release:version` step that rewrites pins inside `public/r`, once no item carries them.

**In boring-factory, its call and its work:** kit-train, the `agents-rN` vendor line, `build/publish-vendor.mjs` for the kit, platform sync of kit files, the kit entries of each app's `platform.json`, and the gate step on a kit bump.

**In apps:** the copied blocks under `web/src/components/`, replaced by imports from their pinned kit.

## Not decided here

- Who opens the bump (above).
- How fast apps must follow a release. Today nothing forces a pin forward, so an unattended app can stay on an old kit indefinitely.
- Whether the move starts before D-400's per-app cleanups land. Those are independent, and either order works.
