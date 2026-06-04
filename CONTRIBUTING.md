# Contributing to Boring UI

Thanks for considering a contribution. This file is the shortest path from "I cloned the repo" to "my change is mergeable."

---

## Setup

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

`pnpm install` requires pnpm 9+ and Node 20+. The repo uses pnpm workspaces — install once at the root, all packages and apps share `node_modules`.

---

## Dev loop

```bash
# Run all dev servers at once
pnpm dev

# Iterate on a single package
pnpm --filter @hachej/boring-workspace test:watch
pnpm --filter @hachej/boring-agent test:watch

# Run the workbench playground (workspace + plugins, no auth backend)
pnpm --filter workspace-playground dev

# Run the production-shaped reference app (auth + DB + agent)
pnpm --filter full-app dev
```

Apps that consume `@hachej/boring-workspace` from source need it built once before tests:

```bash
pnpm --filter @hachej/boring-workspace build && pnpm --filter workspace-playground test:e2e
```

---

## What to know before opening a PR

### Invariants

`pnpm lint:invariants` enforces the plugin contract and agent-isolation rules. It runs in CI; run it locally before pushing:

```bash
pnpm lint:invariants
```

If it fails, look at `packages/workspace/scripts/check-plugin-invariants.mjs` for the rules. Don't loosen the script unless you've discussed the change in an issue first.

### Plugin shape

If you're adding a publishable plugin, start from the package-plugin template:

```bash
mkdir -p plugins
cp -R packages/cli/templates/plugin plugins/<your-name>
cd plugins/<your-name>
# rename sample identifiers/package names for your plugin
pnpm install
pnpm --filter @hachej/boring-<your-name> typecheck
pnpm --filter @hachej/boring-<your-name> test
```

Or manually copy the template from [packages/cli/templates/plugin](packages/cli/templates/plugin/README.md):

```bash
cp -R packages/cli/templates/plugin plugins/<your-name>
```

The `plugins/*` glob in `pnpm-workspace.yaml` picks new plugins up automatically.

### Architecture rules

Four interfaces are load-bearing — see the [README architecture section](README.md#architecture). The big ones:

- **`Workspace` is the only filesystem interface.** Don't add a second one in plugin server code; route through it.
- **`Sandbox` is only for execution.** Don't write files through it.
- **`AgentHarness` doesn't know about files or shells.** It only sees `tools`.
- **Runtime modes (`direct`, `local`, `vercel-sandbox`) swap `Workspace` + `Sandbox`.** Don't conditional on the mode anywhere else.

A plugin breaking these rules will fail invariant lint.

### Tests

- **Unit / integration**: `vitest`. Co-located in `__tests__/` next to source.
- **E2E**: `playwright`. See `apps/workspace-playground/e2e/*.spec.ts` for the patterns. The playground server is the canonical test target.
- **Visual / DOM-shape regressions**: prefer DOM assertions over screenshot diffs (font-shift makes screenshots flaky). See `apps/workspace-playground/e2e/visual.spec.ts` for the pattern.

Don't add a new test setup file. Each plugin owns a copy of `src/test-setup.ts` — keep it in sync with [`packages/cli/templates/plugin/src/test-setup.ts`](packages/cli/templates/plugin/src/test-setup.ts).

### Code style

- No new dependencies without justification — `pnpm` warns on duplicates; tight dep tree matters
- Prefer editing existing files over adding new ones
- Co-locate types with the code that owns them; only promote to `shared/` when both `front/` and `server/` need it
- Comments explain WHY, not WHAT. Default to no comments.

---

## Commits + PRs

- Branch off `main`. Keep PRs focused — one concept per PR.
- Commit messages: `<area>: short imperative` (e.g. `workspace: fix panel registry race on hot reload`).
- Reference the issue if one exists.
- Run `pnpm ci` locally before pushing — it runs lint + typecheck + test + invariants + e2e. If it passes, CI passes.

---

## README screenshots

If you change anything visible in the workspace shell, refresh the README screenshots:

```bash
pnpm --filter workspace-playground dev   # in one shell, leave running
node scripts/take-readme-screenshots.mjs # in another
```

Output goes to `docs/assets/readme/`. The script captures 4 frames: landing, workbench open, sessions drawer, command palette.

---

## License

By contributing, you agree your code is licensed under the [MIT License](LICENSE).
