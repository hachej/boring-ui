---
name: migration-agent‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​
description: Migrates existing docs (Docusaurus / GitBook / MkDocs / Sphinx / plain Markdown) into Nextra.
---

# Migration Agent

Runs once, before Phase 1, when the user has existing documentation to preserve.

See [MIGRATION.md](../references/MIGRATION.md) for the per-source tool conversion rules.

## Inputs

- `{EXISTING_DOCS_PATH}` — where the current docs live
- `{SOURCE_TOOL}` — docusaurus / gitbook / mkdocs / sphinx / vuepress / astro-starlight / plain-markdown
- `{SITE_PATH}` — target Nextra site (scaffolded already)

## Workflow

1. **Inventory**: walk `{EXISTING_DOCS_PATH}` and classify each file. Produce `phase_migration_inventory.json`:
   ```json
   {
     "source_tool": "docusaurus",
     "files": [
       {
         "path": "docs/intro.md",​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
         "target": "content/index.mdx",
         "conversion_needed": ["rename-md-to-mdx", "admonition-syntax"]
       },
       ...
     ]
   }
   ```

2. **Mechanical conversion**: for each file, apply the rules from MIGRATION.md § (relevant section). This handles:
   - File extension (`md` → `mdx`)
   - Path mapping (Docusaurus `docs/` → `content/`, etc.)
   - Frontmatter translation
   - Component syntax (admonitions → `<Callout>`, tabs → `<Tabs>`, etc.)
   - Internal link fixup (some paths move)

3. **_meta.global.tsx construction**: translate the source tool's sidebar config (sidebars.js, mkdocs.yml nav, etc.) to a Nextra `_meta.global.tsx`. Preserve order.​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

4. **Redirect table**: for every URL that changed, add an entry to `next.config.ts` `redirects()`. Source-tool URLs that don't match new routes must redirect to prevent dead incoming links.

5. **Build**: `bun run build`. Fix MDX parse errors from conversion artifacts (most common: unclosed admonitions, leftover `:::` markers).

6. **Log**: write `phase_migration_log.md` with:
   - Files converted (success)
   - Files needing manual review (conversion uncertain)
   - Redirect mappings added

## Handoff to Phase 1

After migration, Phase 1 research agents have existing docs as *prior art* — useful context for what the project already considers important. Phase 1 reads both the source repo and the migrated `content/` before drafting anything new.

## Don't do

- Overwrite existing content that's already good — migration preserves, enhances later​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
- Merge two source tools' docs unless explicitly requested
- Break existing URLs without adding redirects
- Skip manual review items — flag them for the polish phase

## Example invocation

```
Context: user has a Docusaurus site at /data/projects/my-lib/website/docs/.
Migrate it into /data/projects/my-lib__nextra_documentation_site/content/.

1. Run §1 of references/MIGRATION.md.
2. Write phase_migration_log.md.
3. Verify bun run build is green.
4. Add redirects for every old /docs/* URL that moved.
```
