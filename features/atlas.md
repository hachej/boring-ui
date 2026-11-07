# Atlas

The Atlas is one catalogue of every screen and state of an app, shot the same way. This is its first slice: the manifest an app writes (`web/src/atlas.json`), its published JSON schema and the command that checks it. Shooting and the viewer land in later slices of D-1831.

## Sub-features

- `atlas-schema` the manifest format and `boring-ui-blocks atlas <dir> --check [--fixtures <dir>] [--json]`. A state is `id`, `page`, `title`, `given: { fixture, steps? }`, and optionally `flow` and `after` (the label of the arrow that leads to it, only with `flow`); no other field, at either level. `given` is the grammar of an app's `features/examples.json`: `fixture` is a `*.synthetic.*` file of the app's `features/fixtures/` (invented data only), `steps` run in order from `open <screen>`, `upload [<fixture>]` (default `given.fixture`), `click <label>`, `fill <label> <value>` and the atlas-only `wait <text>`; a multi-word label or value is quoted "like this" or « like this ». The schema is `packages/ui/atlas.schema.json` (export `./atlas.schema.json`); the hand-written validator is `packages/ui/bin/atlas.mjs`, dispatched from `packages/ui/bin/boring-ui-blocks.mjs`.

## How to get to it (user POV)

- An app writes `web/src/atlas.json` (point `$schema` at `@hachej/boring-ui/atlas.schema.json` for editor help) and runs `npx boring-ui-blocks atlas web/src --check --fixtures features/fixtures`. Each finding prints with its path, such as `states[2].given.steps[0]`; the exit code is 1 on any finding, 0 otherwise.

## Driving it with the kit's node tests

Preconditions: none (Node only, fictional manifests under `test/fixtures/atlas/`).

- **Schema and check.** `atlas-schema`: `node --test test/atlas.test.mjs` spawns the real bin on a valid manifest (4 states, one flow of 2 with `after`), an unknown verb, a duplicate id, a fixture file the directory lacks, a non-synthetic fixture name, `after` without `flow`, an unbalanced quote and a missing `atlas.json`; it also reads the schema file and requires the validator to agree with it. By hand: `node packages/ui/bin/boring-ui-blocks.mjs atlas test/fixtures/atlas/valid --check --fixtures test/fixtures/atlas/fixtures`.

## Gotchas

- A state is reached by its `given.steps` on the preview's standard fictional seed. A later `--fixture-url` fallback, for data that steps cannot make, will be honoured only on previews and dev identity and refused on live apps; it must never be wired into production. It is not part of this slice.
- Without `--check` the command exits 2 and says shooting lands in the next slice; it never fakes a shot.
- `--fixtures` is optional: without it, only the `*.synthetic.*` name is checked, not that the file exists.
