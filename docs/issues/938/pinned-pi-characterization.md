# Pinned Pi skill discovery characterization

Bead: `wt-391-forward-ehl.5`

Issue: [#938](https://github.com/hachej/boring-ui/issues/938)

Date: 2026-07-25

## Resolved package

The Agent dependency is imported as `@mariozechner/pi-coding-agent` and pinned by `packages/agent/package.json` to:

```text
npm:@earendil-works/pi-coding-agent@0.80.7
```

The lockfile resolves the implementation as:

```text
@earendil-works/pi-coding-agent@0.80.7
```

The characterization imports the real public `loadSkills` export from that alias. It does not mock or reproduce Pi discovery.

## Deterministic evidence

Focused test:

```text
packages/agent/src/server/__tests__/piSkillsCharacterization.test.ts
```

The fixture passes explicit roots in the intended order:

```text
workspace `.agents/skills` → package skill root → shared/global extension skill root
```

Observed behavior for Pi 0.80.7:

1. `loadSkills` processes explicit `skillPaths` in array order.
2. It retains `filePath`, `baseDir`, and synthetic `sourceInfo` for the winning skill.
3. A directory containing `SKILL.md` and that direct `SKILL.md` file produce equivalent `Skill` results.
4. Skills are keyed by frontmatter `name`; same-named later sources are collapsed.
5. The first source wins. Each later source produces a `collision` diagnostic containing stable `winnerPath` and `loserPath` evidence.
6. With `includeDefaults: true`, Pi loads `<agentDir>/skills` before `<cwd>/.pi/skills`. The winning user skill reports `sourceInfo.scope: "user"`; the same-name project skill is reported as the collision loser.
7. Explicit roots are reported as synthetic local/path sources rather than user/project scope, while their absolute source file and base directory remain available server-side.
8. The test asserts the Agent manifest remains pinned to `npm:@earendil-works/pi-coding-agent@0.80.7`, forcing deliberate re-characterization on upgrades.

## Management-listing decision

**Select the canonical registry management-union branch.**

Pi 0.80.7 collapses same-named skills, so `loadSkills(...).skills` cannot be the complete management inventory. #938 must build management rows from canonical registered workspace/package/shared skill sources, keyed by safe `(filesystem, path)` resource identity. It should attach Pi collision diagnostics and mark the Pi-selected winner where useful. Pi remains the authority for prompt/invocation behavior; the first skill in Pi's effective load order is the invocable winner.

The registry may use retained Pi `filePath`/`baseDir` to correlate the winner and diagnostics to registered confined roots, but it must never serialize those host paths to the browser.

## Upgrade gate

Any change to the resolved Pi package/version or effective skill-root ordering must rerun this test and reconsider the management-union expectation before shipping.

## Proof

Canonical rerun command from an installed checkout:

```bash
pnpm --filter @hachej/boring-agent exec vitest run \
  src/server/__tests__/piSkillsCharacterization.test.ts
```

The isolated worktree reused the coordination checkout's installed Vitest binary:

```bash
./node_modules/.bin/vitest \
  --root .worktrees/bead-wt-391-forward-ehl-5/packages/agent \
  run src/server/__tests__/piSkillsCharacterization.test.ts
```

Result: 1 test file passed, 4 tests passed, no type errors.
