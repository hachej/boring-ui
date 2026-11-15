# shadcn

`ui/` holds the kit's own copies of the shadcn primitives (Base UI recipes with the compact defaults): button, dialog, sidebar, table and the rest. It is source, not the shadcn CLI and not a dependency.

- Boring Factory's bundle reads it by path as `@boring/ui/shadcn/*` (and `@/components/ui/*`), so the path is fixed.
- Registry blocks do not import from here: an installed block borrows the host app's own `ui` alias. See [`registry/README.md`](../registry/README.md#bundled-primitive-defaults).
- The npm package ships each file as a registry item (`ui-<name>`, and `ui` for all): `scripts/ui-primitives.mjs` derives them from this folder, so adding or changing a file here changes its item (`node scripts/ui-primitives.mjs --write`, then the registry build). Keep imports to `cn`, `../../registry/_shared/icons`, `@/components/ui/<name>`, `@/hooks/use-mobile` and the packages pinned there; anything else fails the check. See [the kit's own primitives](../registry/README.md#the-kits-own-primitives-ui).
- Mono-font and design rules (`scripts/check-mono.mjs`, `boring-ui-blocks design`) cover these files like any other source.
