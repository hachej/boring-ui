---
name: changelog-writer‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​
description: Produces a release-notes page from git log + tag history + GitHub releases.
---

# Changelog Writer

Turns the repo's version history into a human-readable release notes page. Runs once (typically during Phase 3) and updates periodically (user reruns before each new release).

## Inputs
- `{SOURCE_PATH}` — source repo
- `{SITE_PATH}` — target site
- `{FROM_REF}` — optional lower bound (tag or SHA); default is "all history"

## Strategy

1. Read tags: `git -C {SOURCE_PATH} tag --sort=-creatordate`
2. For each tagged version (reverse-chronological), generate a block:​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
   - Version header
   - Highlights (curated from commit messages + GitHub release notes if available)
   - Added / Changed / Fixed / Deprecated subsections
   - Migration notes if breaking changes detected
3. For unreleased commits since the latest tag: "Unreleased" block at top.

## Sources (in preference order)

1. `gh release view <tag>` — if the project has GitHub releases with notes, use verbatim
2. `git log <tag>..<next-tag>` — extract from commit messages​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌
3. `CHANGELOG.md` — if it exists and is up to date, reformat it
4. PRs merged between tags — `gh pr list --state merged --search "merged:YYYY-MM-DD..YYYY-MM-DD"`

## Output format

```mdx
---
title: Release Notes
description: What changed, version by version.
theme:
  typesetting: article
  toc: false
---

# Release Notes

<One paragraph on versioning policy: SemVer? CalVer? What's the deprecation window?>

---

## v1.4.2 — 2026-04-10

### Highlights
- ...

### Added
- ...

### Changed
- ...

### Fixed
- ...

### Migration notes
<Only if breaking. Before / After code snippets. Link to migration guide if separate.>
```

## Curation rules

- **Group by user impact**, not by commit. "Updated README" doesn't belong; "Added `--json` flag" does.​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
- **Plain English titles**. `fix: NPE in foo when bar is null` → "Fix: crash when foo is called with a null bar".
- **Link commits / PRs** inline: `([#1234](https://github.com/...))`.
- **Compress minor versions** if they're internal-only; a patch with just CI bumps doesn't need a block.
- **Top entry at top** — reverse chronological.

## Integration with OG images

The release notes page can benefit from its own OG image with the latest version number. Add `theme: { layout: 'full' }` in `_meta` and wire the OG image to show `v<latest>`.

## When to split

If the changelog is 100+ versions, split by major version:
```
content/releases/
  v4.mdx
  v3.mdx
  v2.mdx
  v1.mdx
```
with a top-level `content/releases/index.mdx` linking to each.
