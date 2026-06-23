# Troubleshooting

Common issues encountered during the 10-phase run, indexed by symptom.‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

See also:
- [NEXTRA.md#gotchas](NEXTRA.md#gotchas) — framework-level issues
- [DEPLOY.md#troubleshooting](DEPLOY.md#troubleshooting) — deployment issues
- [ADVANCED-NEXTRA.md](ADVANCED-NEXTRA.md) — for edge cases on advanced features

---

## Build errors

### `Error: You are attempting to export a page that has "dynamic" behavior`

Cause: using a Server Component feature in a page that's being statically exported.

Fix:
- If `output: 'export'` in `next.config.ts`, make sure no page uses `cookies()`, `headers()`, or fetches without `{ cache: 'force-cache' }`.
- If you don't need static export, remove `output: 'export'` and use `bun start` or Vercel SSR.

### `Cannot find module 'nextra'` at build time on Vercel

Cause: Vercel's project root is set wrong (pointing at the parent repo instead of the site dir).

Fix: `vercel link` from inside the site dir, not the parent. Verify `.vercel/project.json` has the right project ID.

### MDX parse error: `Unexpected character` near `{`

Cause: literal `{` in prose that MDX interprets as JSX expression.

Fix: escape with `\{` or wrap in inline code: `` `{foo}` ``. Common in docs about templating languages.

### MDX parse error: mismatched tag

Cause: an unclosed JSX tag, usually from a `<Callout>` or `<Tabs>` where the `</Callout>` was eaten by a sed conversion.

Fix: read the error's line number; add the closing tag. `content-lint.mjs` catches most of these if you run it.

### MDX parse error: unclosed fence

Cause: inner triple-backtick code fence inside an outer triple-backtick block.

Fix: outer fence → four backticks. See [NEXTRA.md](NEXTRA.md#code-block-features).

### Build hangs at "Compiling MDX"

Cause: pathological recursion or very large embedded data.

Fix:
- Look for accidental infinite imports (`import X from './X'`).
- Large static data should be imported from `.json`, not inlined.
- If it only happens in dev (Turbopack), try `next build --webpack` as a workaround; file upstream.

### `TypeError: u2 is not iterable` from next/og

Cause: `next/og` (Satori) doesn't support WebP. Often triggered by an imported image.

Fix: convert WebP to PNG/JPEG. See [og-share-images skill](../../og-share-images/SKILL.md).

### `Error: Cannot find module 'nextra/mdx-remote'` on production

Cause: trying to server-render remote MDX with `output: 'export'`.

Fix: remote MDX requires SSR; remove `output: 'export'` or pre-render the content at build time.

---

## Runtime / rendering issues

### Sidebar is empty

Cause: `pageMap` not passed to `<Layout>`, or `_meta.global.tsx` has a syntax error.

Fix:
```tsx
import { getPageMap } from 'nextra/page-map'

const pageMap = await getPageMap()
<Layout pageMap={pageMap}>{children}</Layout>
```

Check `app/_meta.global.tsx` compiles: `bun run typecheck`.

### Search returns no results​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌

Cause: Pagefind's postbuild didn't run, or pointed at the wrong output directory.

Fix: verify `public/_pagefind/pagefind.js` exists after build. For `output: 'export'`, swap Pagefind's `--site` flag to `out/`.

### Dark mode flash of wrong content (FOUC)

Cause: `suppressHydrationWarning` missing from `<html>`.

Fix:
```tsx
<html lang="en" dir="ltr" suppressHydrationWarning>
```

The `next-themes` library depends on this to avoid SSR mismatch.

### Mermaid diagrams don't render

Cause: either the language tag is wrong or the diagram syntax is invalid.

Fix:
- Language tag must be `mermaid` (not `mmd` or `diagram`).
- Syntax errors in the diagram don't block the build; they silently fail to render. Paste the diagram into https://mermaid.live/ to validate.
- Dark mode: the default theme may render with low contrast in dark mode. Wrap with a themed `<Mermaid>` — see [ADVANCED-NEXTRA.md](ADVANCED-NEXTRA.md#7-mermaid--advanced-diagrams).

### KaTeX math renders as plain text

Cause: `latex: true` missing from `next.config.ts`.

Fix: add it. Also verify `katex/dist/katex.min.css` is loaded (Nextra does this automatically if `latex: true`).

### Search bar is there but nothing happens

Cause: Pagefind bundle didn't ship (404 on `/_pagefind/pagefind.js`).

Fix:
- Verify postbuild ran: `ls public/_pagefind/`.
- On Vercel: sometimes `public/_pagefind` needs to be in `outputDirectory` — check Vercel build logs.

### Images 404 in production

Cause: static images in `public/` referenced with `./img.png` (relative) instead of `/img.png` (absolute).

Fix: all `public/` references must be absolute paths starting with `/`.

### "Edit this page" link goes to 404

Cause: `docsRepositoryBase` points at the repo root instead of the folder holding MDX.

Fix: append the path. For MDX at `<repo>/docs/content/`, `docsRepositoryBase` should be `https://github.com/org/repo/blob/main/docs`.

### Page shows but heading anchors don't work

Cause: heading anchors generated from heading text contain characters that break URL parsing.

Fix: Nextra slugifies well by default. If you've overridden heading components in `mdx-components.tsx`, ensure you preserve the `id` attribute from the default.

---

## Deploy issues

### Vercel deploy succeeds but site is blank

Cause: `output: 'standalone'` without matching Vercel config.

Fix: remove `output: 'standalone'`. Vercel wants the default output. Standalone is for Docker.

### Vercel deploy succeeds but search broken

Cause: Vercel cached an old deploy where postbuild didn't produce `_pagefind/`.

Fix: redeploy with `vercel --prod --force`.

### Vercel deploy time is extremely long

Cause: pulled in the parent repo as dependency (common when site dir is nested).

Fix: make sure only the site dir is the project root. Verify `.vercelignore` excludes the parent and all source code you don't need.

### Vercel build fails with "Node version"​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

Fix: add `.node-version` with `22` (or your preferred Node version) at the site dir root.

### Cloudflare Pages build: `Module not found: 'fs'`

Cause: Cloudflare Pages can't run Pagefind (needs Node file I/O during build).

Fix: switch to static export (`output: 'export'`), run Pagefind in a CI step before upload, then deploy the prebuilt output to Cloudflare Pages.

---

## Phase-specific issues

### Phase 1: agents miss parts of the codebase

Cause: the partition was too coarse; the agent didn't drill into a subfolder.

Fix: refine the Phase 0 partition. Specify paths explicitly in the agent prompt. If the user noticed something missing, re-spawn that section's research agent with additional paths in the prompt.

### Phase 2: drafts contain hallucinated APIs

Cause: agent didn't verify against source before writing.

Fix: the Phase 2 prompt says "every code example uses actual identifiers from the source repo". Check `phase2_open_questions.md` for agent-raised uncertainty; if items are there, the agent was doing the right thing. If not, re-run with stricter grounding: prefix the prompt with "GROUND EVERY API CALL. Before writing `X(...)`, grep for `X` in {SOURCE_PATH}. If not found, don't write it."

### Phase 3: synthesis pages duplicate section content

Cause: the synthesis agent re-explained what sections already said.

Fix: the synthesis operator explicitly produces CROSS-CUTTING content — the "one-sentence elevator" for each section isn't duplication; it's pointing. Re-run with: "Your job is NOT to re-explain each section. Your job is to connect them and add what only appears when you see the whole."

### Phase 4 polish is just reformatting

Cause: polisher is running in cosmetic mode, not substantive mode.

Fix: the polisher prompt requires substantive changes for non-trivial pages. If the pass log is all `[trivial]`, either:
- The drafts are actually good (congrats — you're done with Phase 4), or
- The polisher is being lazy. Re-prompt: "Every page needs at least ONE of: new diagram, new example, new cross-link, new gotcha, or rewritten intro. If a page has none of these after your edit, it wasn't actually polished."

### Phase 4 never terminates

Cause: the termination rule ("≥2 passes with only trivial changes") isn't being hit because polishers keep finding things to change.

Fix: after 4 rounds, declare done and move on. Diminishing returns.

### Phase 6 build breaks after component uplift

Cause: an MDX fence inside a JSX component (Steps, Tabs) is using 3 backticks where 4 are needed.

Fix: outer fence → 4 backticks. See the upfront pattern in [NEXTRA.md](NEXTRA.md#code-block-features). If `bun run build` fails with "unexpected token", this is usually the cause.

### Phase 7 fresh-eyes keeps finding the same issue

Cause: the issue is actually with the source code, not the docs.

Fix: file the issue as a bug on the source repo (via `gh issue create` or the
GitHub connector). Docs describe the system as it is; don't paper over bugs.

### Phase 8 Vercel login fails in a SSH session

Cause: browser OAuth can't open a browser on a headless box.

Fix:
- Use `vercel --token $VERCEL_TOKEN` with a token from https://vercel.com/account/tokens.
- Set the token in the shell environment or in `~/.vercel/auth.json`.

### Phase 9 Playwright can't find the dev server

Cause: `bun dev` started in the background but the test runs before the server is ready.

Fix: wait for readiness before running tests:
```bash
bun dev &
SERVER_PID=$!
until curl -s http://localhost:3000 > /dev/null; do sleep 1; done
bunx playwright test
kill $SERVER_PID
```

---

## jsm / skill installation issues​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍

### `jsm: command not found`

Cause: `jsm` installed but `~/.local/bin` not in PATH.

Fix:
```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### `jsm login` opens a URL but never returns

Cause: OAuth callback couldn't reach the local jsm process (firewall or SSH without port-forward).

Fix: use `jsm auth` with an API key from the jeffreys-skills.md dashboard instead of OAuth.

### `jsm install` returns `SUBSCRIPTION_REQUIRED`

Cause: the skill is premium but the user's subscription isn't active.

Fix: log it as a missing skill with `can_install_via_jsm: true, requires_subscription: true` and continue with the inline fallback. Offer the user the subscription link once per run.

### `jsm whoami` says `Not logged in` after login

Cause: credential file is encrypted and the current shell doesn't have the passphrase.

Fix:
```bash
export JSM_ALLOW_ENV_PASSPHRASE=1
export JSM_CREDENTIALS_PASSPHRASE='<your-passphrase>'
jsm whoami
```

---

## Content quality issues

### Content-lint reports many P1 failures

Cause: intro paragraphs are too short on many pages.

Fix: run the `★ ORIENT` operator (see [OPERATOR-LIBRARY.md](OPERATOR-LIBRARY.md#meta-operator--orient)) across all flagged pages. This is often a batch issue if Phase 2 agents were rushed.

### Pages feel generic / interchangeable

Cause: Phase 4 polishers didn't ground content in the specific project — they wrote "a library for X" prose that could apply to anything.

Fix: re-prompt Phase 4 with "Every paragraph must say something that's specific to THIS project, not any project of its type. If you can delete the project name from a sentence and it still reads the same, rewrite."

### Reader reports "I couldn't find X"

Cause: search missed it, or the sidebar doesn't surface it.

Fix:
1. Grep `content/` for X. Is it present?
2. If present, is the page in `_meta.global.tsx`?
3. Is X in the glossary?
4. Consider adding a Cards grid on a related section for better findability.

### Diagrams render in light mode but not dark

Cause: Mermaid using default theme with low contrast in dark mode.

Fix: wrap `<Mermaid>` with a theme-aware config ([ADVANCED-NEXTRA.md §7](ADVANCED-NEXTRA.md#7-mermaid--advanced-diagrams)).

---

## Quick self-diagnosis

Before asking for help, run:

```bash
cd <site-dir>
bun install && bun run build && bun run typecheck
./scripts/content-lint.mjs content/
./scripts/link-check.mjs content/
./scripts/audit-content.mjs content/
```

If those all pass, the issue is likely content-quality (subjective) rather than systemic. Run `/ux-audit` (if available) for a qualitative review.

If any fail, the error message usually names the fix. Paste the exact error into this file's search — most are here.
