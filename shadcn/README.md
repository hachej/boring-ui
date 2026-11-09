# shadcn

`ui/` holds the kit's own copies of the shadcn primitives (Base UI recipes with the compact defaults): button, dialog, sidebar, table and the rest. It is source, not the shadcn CLI and not a dependency.

- Boring Factory's bundle reads it by path as `@boring/ui/shadcn/*` (and `@/components/ui/*`), so the path is fixed.
- Registry blocks do not import from here: an installed block borrows the host app's own `ui` alias. See [`registry/README.md`](../registry/README.md#bundled-primitive-defaults).
- Mono-font and design rules (`scripts/check-mono.mjs`, `boring-ui-blocks design`) cover these files like any other source.
