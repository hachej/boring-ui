# Pinned Pi skill discovery characterization

Issue: [#938](https://github.com/hachej/boring-ui/issues/938)

`@mariozechner/pi-coding-agent` resolves to the pinned Earendil Pi implementation. The focused test imports its public `loadSkills` API directly:

```text
packages/agent/src/server/__tests__/piSkillsCharacterization.test.ts
```

The behavior #938 relies on is deliberately small:

1. Explicit skill roots are processed in array order.
2. Skills are keyed by frontmatter `name`; the first same-name source wins.
3. Later duplicates produce collision diagnostics identifying winner and loser paths.
4. A skill directory and its direct `SKILL.md` path are equivalent inputs.

Therefore Pi remains authoritative for invocation and duplicate-name winners, while the management catalog preserves distinct browser-safe `(filesystem, path)` resource identities. Absolute Pi paths are used only for server-side correlation and are never serialized.

Re-run after any Pi upgrade or effective skill-root ordering change:

```bash
pnpm --filter @hachej/boring-agent exec vitest run \
  src/server/__tests__/piSkillsCharacterization.test.ts
```
