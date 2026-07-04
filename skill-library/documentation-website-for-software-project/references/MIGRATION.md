# Migrating to Nextra‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

When the user already has docs in Docusaurus, GitBook, MkDocs, VuePress, Sphinx, or plain Markdown — don't rewrite from scratch. Migrate.

This file covers the mechanical conversion. Content-quality polishing still goes through Phases 4–6.

---

## Decision tree

```
User already has docs?
│
├─ No     → skip this file; run Phase 1 normally.
│
└─ Yes    → check source tool:
           ├─ Docusaurus      → see §1
           ├─ GitBook         → see §2
           ├─ MkDocs / Material → see §3
           ├─ Sphinx (reST)   → see §4
           ├─ VuePress        → see §5
           ├─ Astro Starlight → see §6
           └─ Plain Markdown  → see §7
```

---

## §1 Docusaurus → Nextra

Docusaurus is the closest analog. The translation is mostly 1:1 with some syntactic swaps.

### File conventions

| Docusaurus | Nextra 4 |
|------------|----------|
| `docs/intro.md` | `content/index.mdx` |
| `docs/category/_category_.json` with `position`, `label` | `content/category/_meta.js` (or rolled into `app/_meta.global.tsx`) |
| `docusaurus.config.js` navbar | `<Navbar>` in `app/layout.tsx` + `_meta.global.tsx` |
| `docusaurus.config.js` footer | `<Footer>` in `app/layout.tsx` |
| `sidebars.js` | `_meta.global.tsx` |
| `docs/version-X/` | version menu in `_meta.global.tsx` + folder-based or deployment-based versioning (see [ADVANCED-NEXTRA.md](ADVANCED-NEXTRA.md#10-versioned-docs)) |
| `i18n/<lang>/` | `content/<lang>/` with i18n config (see [ADVANCED-NEXTRA.md](ADVANCED-NEXTRA.md#11-i18n-internationalization)) |
| `blog/` | `content/blog/` with per-page `theme: { typesetting: 'article' }` |

### MDX frontmatter

Docusaurus fields that translate:
- `title` → `title`
- `description` → `description`
- `sidebar_position` → handled by `_meta.js` key order
- `sidebar_label` → `_meta.js` value (`'my-page': 'Friendly Label'`)
- `slug` → put the file at the slugged path in `content/`
- `tags` → no direct Nextra equivalent; drop or store separately

### Component mapping

| Docusaurus | Nextra | Notes |
|------------|--------|-------|
| `<Tabs>` + `<TabItem>` | `<Tabs items={[]}>` + `<Tabs.Tab>` | Syntax shift |
| `<Admonition type="...">` | `<Callout type="...">` or `> [!NOTE]` | note/tip/info/warning/danger → info/warning/error/important |
| `<CodeBlock>` | just use fenced ` ``` ` blocks | Nextra code fences have all features inline (filename, highlight) |
| MDX `{% …%}` Liquid-like tags | MDX JSX expressions `{…}` | |
| `@site/static/img/X.png` | `/img/X.png` (in `public/`) | |
| `@docusaurus/Link` | `<Link>` from `next/link` or plain `<a>` | |

### Conversion script (first pass)

```bash
#!/usr/bin/env bash
# docusaurus-to-nextra.sh
# Mechanical conversion. Manual review still required.

SRC="$1"   # path to docusaurus docs/
DST="$2"   # path to content/​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌

rsync -a "$SRC/" "$DST/"

# Rename .md to .mdx
find "$DST" -name '*.md' | while read f; do
  mv "$f" "${f%.md}.mdx"
done

# Admonitions → Callouts (first pass; manual cleanup needed)
find "$DST" -name '*.mdx' -exec sed -i \
  -e 's|:::note|<Callout type="info">|g' \
  -e 's|:::tip|<Callout type="info">|g' \
  -e 's|:::info|<Callout type="info">|g' \
  -e 's|:::warning|<Callout type="warning">|g' \
  -e 's|:::danger|<Callout type="error">|g' \
  -e 's|:::caution|<Callout type="warning">|g' \
  -e 's|:::|</Callout>|g' \
  {} +

# Add imports to files that now use Callout
grep -l '<Callout' "$DST"/**/*.mdx | while read f; do
  sed -i '1i import { Callout } from "nextra/components"\n' "$f"
done

# _category_.json → _meta.js (convert manually — simple cases only)
find "$DST" -name '_category_.json' | while read f; do
  dir=$(dirname "$f")
  echo "// TODO: manual conversion needed for $f → $dir/_meta.js"
done

echo "Done. Manual review needed for:"
echo "- Component imports at top of each .mdx"
echo "- _category_.json → _meta.js"
echo "- sidebars.js → app/_meta.global.tsx"
echo "- Tabs syntax"
echo "- next.config.ts settings"
```

### Not automatically convertible

- Docusaurus themes / custom CSS — start from Nextra defaults
- Plugins (search, blog, analytics) — each has a Nextra equivalent in [ADVANCED-NEXTRA.md](ADVANCED-NEXTRA.md)
- `docusaurus.config.js` `themeConfig.algolia` — configure Nextra's Pagefind or swap to Algolia (see [ADVANCED-NEXTRA.md](ADVANCED-NEXTRA.md#3-swapping-search-backends))

### Validation

After conversion: `bun run build` must succeed. Most failures come from:
1. Unclosed Callout / Tabs JSX (the sed approximation leaves edge cases)
2. Leftover `:::` markers (double-check)
3. Missing imports (add `import { Callout } from 'nextra/components'` where needed)

---

## §2 GitBook → Nextra

GitBook exports to Markdown + a `SUMMARY.md` table of contents.

### Steps

1. Export GitBook as Markdown (File → Export → GitBook CLI or the GUI).
2. Copy the `.md` files into `content/` preserving folder structure.
3. Convert `SUMMARY.md` (nested bullet list) into `app/_meta.global.tsx`. This is a manual step; the SUMMARY's indentation directly maps to nested `items:`.
4. Rename `.md` → `.mdx`.

### GitBook-specific syntax

| GitBook | Nextra |
|---------|--------|
| `{% hint style="info" %}…{% endhint %}` | `<Callout type="info">…</Callout>` |
| `{% tabs %}` / `{% tab %}` | `<Tabs items={[]}>` / `<Tabs.Tab>` |
| `{% embed url="…" %}` | plain `<iframe>` or remove |
| `{% api-method %}` | convert to a `## Parameters` table |
| Page-level `description:` frontmatter | works as-is in Nextra |

GitBook's default theme has a lot of features (table of contents, reader comments, etc.) that Nextra handles differently. See [ADVANCED-NEXTRA.md](ADVANCED-NEXTRA.md) for equivalents.​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

---

## §3 MkDocs (especially Material theme) → Nextra

MkDocs uses YAML configuration + standard Markdown with extensions.

### File conventions

| MkDocs | Nextra |
|--------|--------|
| `docs/` | `content/` |
| `docs/index.md` | `content/index.mdx` |
| `mkdocs.yml` `nav:` | `app/_meta.global.tsx` |
| `docs/assets/` | `public/` |
| `docs/overrides/` (theme customization) | `mdx-components.tsx` + global CSS |

### Admonition conversion

MkDocs Material uses `!!! note "Title"`:

```
!!! note "Title"
    Body paragraph.

    Can have multiple paragraphs.
```

Nextra equivalent:

```mdx
<Callout type="info" title="Title">
  Body paragraph.

  Can have multiple paragraphs.
</Callout>
```

Automatable with regex, but watch for multi-paragraph indentation.

### PyMdown extensions

MkDocs Material with PyMdown has many niche extensions (SuperFences, Tabbed, etc.). Most map naturally to Nextra:
- `=== "Tab 1"` → `<Tabs items={['Tab 1', ...]}>`
- `!!! abstract` / `!!! quote` → `<Callout type="info">` with an emoji prop
- `:material-icon:` → use `lucide-react` icons or emoji

### Search

MkDocs has built-in Lunr-based search. Swap for Pagefind (see [NEXTRA.md](NEXTRA.md#search-pagefind)).

---

## §4 Sphinx (reST) → Nextra

Sphinx uses reStructuredText, which is syntactically different from Markdown. This is the highest-friction migration.

### Steps

1. Convert `.rst` to `.md` using `pandoc`:
   ```bash
   find docs -name '*.rst' | while read f; do
     pandoc --from rst --to gfm "$f" -o "${f%.rst}.md"
   done
   ```
2. Rename `.md` → `.mdx`.
3. Convert `index.rst` top-level toctrees to `_meta.global.tsx` (manual).
4. Replace Sphinx directives:

| Sphinx | Nextra |
|--------|--------|
| `.. note::` / `.. warning::` | `<Callout type="info">` / `<Callout type="warning">` |
| `.. code-block:: python` | fenced ` ```py ` |
| `.. image::` | `![](...)` |
| `.. toctree::` | `_meta.js` order + `<Cards>` on landing |
| `:doc:` / `:ref:` cross-references | Markdown links `[text](./path)` |
| `.. automodule::` / `.. autoclass::` | auto-generated reference — use `<TSDoc>` for TS projects, or preserve Sphinx output separately and link to it (`/api/` subdomain) |

### Keep Sphinx for auto-generated API reference

If the project is Python and has heavy autodoc usage, it's often easier to **keep Sphinx for `/api/` and use Nextra for everything else**. Host Sphinx output at `/api/` via Next.js `rewrites` or a static prefix:

```ts filename="next.config.ts"
async rewrites() {
  return [{ source: '/api/:path*', destination: '/_sphinx_out/:path*' }]
}
```

The Nextra narrative pages link to specific Sphinx pages for API lookup. Best of both worlds.

---

## §5 VuePress → Nextra

VuePress is Vue-based; most content is plain Markdown with Vue component interpolation. Migration mechanics are close to Docusaurus:

- `docs/.vuepress/config.js` → `app/_meta.global.tsx` + `<Navbar>/<Footer>` in `app/layout.tsx`
- `docs/.vuepress/theme/` → Nextra theme override via `mdx-components.tsx`
- `.md` files → `.mdx` (rename, then fix any Vue-specific syntax)
- `<VueComponent/>` in Markdown → rewrite as a React component in `components/` or drop​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍

Vue-specific Markdown extensions to convert:
- `::: tip / ::: warning / ::: danger` → `<Callout type="info/warning/error">`
- `<<< @/snippet.js` code imports → manually inline or use Nextra's remote MDX pattern

---

## §6 Astro Starlight → Nextra

Both are MDX-based. The migration is largely file-path and frontmatter:

- `src/content/docs/` → `content/`
- `astro.config.mjs` `starlight({ sidebar })` → `_meta.global.tsx`
- `<Aside>` components → `<Callout>`
- Starlight `<LinkCard>` → Nextra `<Cards>`
- Starlight-specific components → reimplement or drop

Astro's built-in search → Pagefind (Starlight uses Pagefind, so this one's free).

---

## §7 Plain Markdown folder → Nextra

Easiest case.

1. Copy Markdown files to `content/`.
2. Rename `.md` → `.mdx`.
3. Write `_meta.global.tsx` from scratch based on the folder structure.
4. Check for GitHub-flavored extensions:
   - GFM tables — work as-is
   - GFM task lists — work as-is
   - GitHub alerts `> [!NOTE]` — work as-is (Nextra supports these)
   - GitHub image embeds `![alt](path)` — work as-is if paths are relative or `/`-prefixed
   - GitHub mentions `@user` — render as plain text (fine)

5. `bun run build` — most Markdown files just work. The common failure is MDX parser choking on `{` or `<` in prose — escape with `\{` or `\<`.

---

## Post-migration checklist

Regardless of source tool:

- [ ] `bun run build` green
- [ ] Broken-link check green (old deep links may have moved)
- [ ] Old URL redirects in `next.config.ts` for any moved pages
- [ ] Search works (Pagefind indexed)
- [ ] Navbar / sidebar correct
- [ ] Images load
- [ ] Callouts render (not leaking raw `:::` or `!!!`)
- [ ] Code blocks have correct language tags
- [ ] Frontmatter `title` and `description` on every page
- [ ] `docsRepositoryBase` updated to point at the new repo/folder
- [ ] Edit-on-GitHub link resolves
- [ ] Version menu (if multi-version)
- [ ] 404 page exists (Next.js `not-found.tsx`)
- [ ] Social preview images generated (see [ADVANCED-NEXTRA.md](ADVANCED-NEXTRA.md#18-og-image-generation-with-nextog))
- [ ] Run content-lint: hopefully mostly green
- [ ] Phase 4 polish pass on the converted content (the mechanical conversion rarely produces polished docs on its own)

---

## Redirecting old URLs

After migration, do NOT break incoming links. Add a redirect table in `next.config.ts`:

```ts
async redirects() {
  return [
    { source: '/docs/old-path', destination: '/new-path', permanent: true },
    { source: '/guide/:slug', destination: '/docs/guides/:slug', permanent: true }
  ]
}
```

Use `permanent: true` (HTTP 308) for moved content, `permanent: false` (HTTP 307) for temporary redirects. Test with `curl -I https://yoursite.com/old-path`.

The upstream Nextra docs site has a great example of redirect patterns at `/tmp/nextra/docs/next.config.ts:83-124`.
