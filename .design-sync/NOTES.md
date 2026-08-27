# design-sync notes — @hachej/boring-ui-kit

Repo-specific gotchas for future syncs. Read before running anything.

## Run command

Build and validate are NOT run from the package dir — run from the repo root:

```sh
node .ds-sync/resync.mjs --config .design-sync/config.json \
  --node-modules packages/workspace/node_modules \
  --entry ./packages/ui/dist/index.js --out ./ds-bundle
```

## Fixes discovered (2026-08-11, first sync)

- **`--node-modules` must be `packages/workspace/node_modules`, not `packages/ui/node_modules`.**
  Two things resolve from it and only that path satisfies both: React/`@types/react` (present in
  either) **and** `@hachej/boring-ui-kit` itself, which `copyTokens` needs. pnpm doesn't self-link a
  workspace package into its own `node_modules`, but `packages/workspace` depends on the kit, so
  `packages/workspace/node_modules/@hachej/boring-ui-kit -> ../../../ui` exists there.

- **`packages/ui/package.json` needed a top-level `"types": "./dist/index.d.ts"`.**
  It previously declared types only under `exports['.'].types`. The converter's entry resolver
  (`lib/dts.mjs` `projectFor`) reads `pkg.types || pkg.typings || 'index.d.ts'` only, so it looked for
  a non-existent `packages/ui/index.d.ts`, found zero exports, and reported `[ZERO_MATCH] tokens-only
  DS` — while still printing `173 exported PascalCase symbols` from a later, unrelated parse. That
  split output is the tell. One line in package.json fixed it; keep it there.
  (A `.design-sync/overrides/dts.mjs` fork does NOT fix this on its own — `lib/source-kit.mjs`
  statically imports `./dts.mjs` from the staged `.ds-sync/lib/`, so the override never reaches the
  discovery path. The abandoned fork is parked at `.design-sync/.cache/overrides-unused/`.)

- **Tokens need BOTH `tokensPkg` and `tokensGlob`.** `copyTokens` returns early when `tokensPkg` is
  unset, so `tokensGlob` alone silently does nothing. Symptom: `[TOKENS_MISSING] 35 CSS custom
  properties` and `styles.css: 1 @import`. With both set it's `2 @import(s)` and `tokens: 173 defined`.
  The tokens are in the same package (`dist/tokens.css`), not a sibling — hence the self-reference.

- **Blank previews were a tokens problem, not a preview problem.** Avatar, Input and Textarea were
  flagged `[RENDER_BLANK]` purely because `--boring-*` was undefined. They cleared themselves once
  tokens shipped. Fix global CSS before touching any `.tsx`.

## Fonts — unresolved, decision needed

`[FONT_MISSING] "Geist", "Geist Mono"` is currently **suppressed** via
`cfg.runtimeFontPrefixes: ["Geist"]`, not solved. There is no woff2 anywhere in this repo and no
`@font-face`; the host apps load Geist from Google Fonts with a `<link>` in
`apps/workspace-playground/index.html`. Claude Design is its own host and does NOT load that link, so
**every design built with this DS currently renders in a system-font fallback.**

To fix properly: add the `geist` npm package (OFL) or vendor its woff2 files into the repo, then point
`cfg.extraFonts` at the `@font-face` CSS. This was not done unilaterally because it means committing
font binaries. Owner decision.

## Known render warns

Re-syncs should treat these as already-triaged; anything else is new.

- `[RENDER_BLANK] Checkbox` — floor card; the bare input renders <5KB. Needs an authored preview.
- `[RENDER_THIN] DetailLine` — floor card, mounted text is just the name. Needs an authored preview.
- `[RENDER_BLANK] DisclosureChevron` — floor card; it's a bare chevron glyph. Compose it inside
  `Disclosure` when authoring.

These three were **deliberately excluded from the upload** (never push a card you know is broken), so
the project holds 170 of 173 components. Authoring their previews is what lets them ship.

## State at end of first sync

- Uploaded: 170 components (4 files each) + bundle, styles, tokens, `_vendor/`, README = 687 files.
- **No `_ds_sync.json` anchor was written** — deliberate. Previews are unauthored and 3 components are
  missing, so the project does not match a fully verified build. The next sync therefore re-verifies
  everything from scratch, which is correct. Do not hand-write the anchor.
- All 173 components are importable with real `.d.ts` contracts and `.prompt.md` docs. 170 show the
  typographic floor card ("preview not yet authored") — the deliberate baseline, not a failure.

## Re-sync risks

- **The `--node-modules` path is load-bearing and fragile.** It depends on `packages/workspace` keeping
  its dependency on the kit. If that link disappears, tokens silently stop shipping (watch for
  `[TOKENS_MISSING]` and `styles.css: 1 @import`).
- **The `types` field in `packages/ui/package.json` is load-bearing for this sync.** If a future
  refactor drops it, discovery collapses to `[ZERO_MATCH]` again.
- **`conventions.md` enumerates ~280 utility class names** that exist only because the kit's own
  components use them. Adding or removing components changes that compiled set. Re-validate the class
  table in `conventions.md` against `ds-bundle/_ds_bundle.css` on every sync — a class named there but
  absent from the CSS makes the design agent emit silently unstyled markup.
- **Root `node_modules` symlinks point into `.worktrees/full-agenthost-cutover/`.** This checkout's
  install is shared with another worktree. A sync run from a different worktree may resolve different
  package versions.
- Previews were never authored, so nothing carries forward yet in `.design-sync/previews/`. The scoped
  set agreed with the owner was ~39 core components (Button, Input, Field, Select, Pane, Card, Dialog,
  DropdownMenu, Tabs, Notice, EmptyState, List, Badge, Toolbar, SettingsPanel and similar).
