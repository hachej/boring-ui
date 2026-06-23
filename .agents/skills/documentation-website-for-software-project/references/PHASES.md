# Phases 1–10 Playbook‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

Detailed exit criteria, deliverables, and agent fan-out for each phase. The main agent is the orchestrator; subagents do work in parallel.

---

## Mode variants

The skill ships three run modes. Pick at Phase 0 based on time budget, stakes, and repo size. Each mode keeps the same 10 phases but varies *depth* — subphases and triangulation pass counts.

| Phase | Quick (30–60m) | Standard (2–4h) | Comprehensive (½–1 day) |
|---|---|---|---|
| 0 Partition | Main agent, 5 min | Main agent + dueling idea-wizards, 10 min | Full dueling wizards + audience mapping, 20 min |
| 1 Research | 1 subagent per section | 1 per section, + research dump per subsystem | 2-model independent research (Claude + Codex) per subsystem |
| 2 Draft | Same agent owns section end-to-end | Dedicated drafter per section | Per-section drafter + per-page-type specialist (tutorial/reference/concept) |
| 3 Synthesize | Main agent only | Dedicated synthesizer | Synthesizer + contradiction sweep agent |
| 4 Polish | 1 Claude pass per section | 1 Claude + 1 triangulator (Codex or Gemini) | Full triangulation: Claude + Codex + Gemini + merge |
| 5 Glossary | Basic glossary + index | Full glossary + term cross-linking | Glossary + machine-readable export + FAQ sourcing |
| 6 Nextra-ify | Core components (Callout, Tabs, Steps) | + Cards, FileTree, Mermaid | + Sandpack/VHS/interactive, dynamic OG images |
| 7 Fresh-eyes | 1 pass, 1 model | 2 passes, 1 model | 3 passes, 3 independent models, adjudicated |
| 8 Deploy | Vercel preview only | Vercel preview → production promote | Preview → prod + Cloudflare mirror + docset export |
| 9 E2E | Playwright smoke on 5 pages | Playwright smoke + a11y + perf on all pages | Smoke + a11y + perf + visual regression + search eval |
| 10 User-lens | Skipped or 1 persona | 3 personas | All 5 personas (see [AUDIENCE.md](AUDIENCE.md)) |

**Quick** exists for first-draft internal docs where the reader will forgive rough edges. It still produces a deployable site. It does NOT produce reliable documentation of subtle behavior — use Standard+ for anything users will pay for.

**Standard** is the default. Most OSS libraries, SDKs, and internal tools hit the quality bar here.

**Comprehensive** is for flagship projects, paid products, and docs that compound as marketing. The skill's long tail of reference files (WRITING-CRAFT, DIAGRAMS, INTERACTIVE, SHOWCASE-GALLERY, ADR-PATTERNS) is targeted at Comprehensive runs.

Mode is recorded in `workspace/partition.json` at Phase 0. Phase gates (especially Phase 7 termination) adjust based on mode.

---

## Phase 0: Partition & Kickoff (5–10 min, main agent only)

Before any fan-out, the main agent:

1. **Confirm inputs** with user: target repo path (or git URL to clone), site dir name, deploy target, package manager. See the up-front confirmations list in SKILL.md.
2. **Clone if needed** to `/tmp/<repo-name>` when given a URL; treat the cloned path as the source from that point on.
3. **Initialize site directory**:
   ```bash
   mkdir -p /data/projects/<repo>__nextra_documentation_site
   cd /data/projects/<repo>__nextra_documentation_site
   git init -b main
   ```
4. **Partition the source repo** into sections. The partition is the unit of parallelism — one subagent per section.

   Good partitions usually come from:
   - Top-level workspace members (`crates/*`, `packages/*`, `apps/*`)
   - `src/<subsystem>/` directories when the project is a single crate/package
   - Logical layers (CLI / core / storage / API) when the codebase is flat
   - For a small repo (<5k LOC total), a single "core" section is fine

5. **Emit a partition plan** to the user as a table *before* fanning out:

   ```markdown
   | Section | Source path | Draft pages (target) | Subagent id |
   |---------|-------------|----------------------|-------------|
   | cli     | src/cli/    | cli/overview, cli/commands/*, cli/config | A |
   | core    | src/core/   | core/overview, core/<module>/*         | B |
   | storage | src/db/     | storage/overview, storage/schema, ...  | C |
   ```

6. **Bootstrap a shared workspace** for the run:
   ```
   <site-dir>/.docs_workspace/
     partition.json              # machine-readable version of the plan above
     phase1_notes/
       <section>.md              # archaeology notes from each agent
     phase2_drafts_index.md      # running list of written pages
     phase3_synthesis_plan.md
     phase4_polish_log.md
     phase5_glossary.md
     phase6_nextraify_log.md
     phase7_review_log.md
   ```
   These files are the run's persistent memory — they survive context compaction.

**Exit criteria:** Partition plan accepted by user. Workspace folders exist. User gave the green light to proceed.

---

## Phase 1: Research (PARALLEL per section)

Each section owner spawns an Explore-style agent using the exact prompt in
[AGENT-PROMPTS.md](AGENT-PROMPTS.md#phase-1--section-research-agent). The agent follows the methodology from `/codebase-archaeology`:

1. Read `AGENTS.md`, `README.md`, top-level `CHANGELOG.md` if present.
2. List the files in the section; identify entry points, key types, data flow.
3. Grep for configuration sources, external integrations, tests.
4. Produce `<section>.md` in `phase1_notes/` using the template from `/codebase-report`.

**Deliverables per section:**
- `phase1_notes/<section>.md` with: executive summary, entry points (file:line), key types (file:line), data flow ASCII, external deps, config sources, test infrastructure, open questions.

**Coordination:** No file-writes in the site tree yet. Research notes only. Agents run in fire-and-forget parallel — the main agent collects the results.

**Exit criteria:** Every section has a filled-in `<section>.md`. Main agent posts a one-paragraph summary per section to the user and asks if any section needs re-research (e.g., if the user says "hmm, you missed the plugin system, look again").

---

## Phase 2: Draft (PARALLEL per section — same agent as Phase 1)

The Phase-1 owner continues onto drafting, because it holds the context. New agents would pay a context tax re-reading everything.​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌

**Each agent:**
1. Opens its `phase1_notes/<section>.md`.
2. Drafts MDX files under `<site-dir>/content/<section>/`.
3. For each page, hits the [Polish Bar](../SKILL.md#the-polish-bar-non-negotiable) rubric on first pass (not just a ref-dump).
4. Writes an `_meta.js` in the section directory declaring page order.
5. Appends every file it creates to `phase2_drafts_index.md` (one line per file, `sha256` after initial write).
6. Uses Agent Mail file reservations on `content/<section>/**` with `reason="nextra-docs-phase2-<section>"` so the polishers don't stomp mid-write.

**Page types drafted in Phase 2 (per section):**
- `overview.mdx` — what this section is, motivation, where it sits
- One page per notable module / command / concept
- `gotchas.mdx` if the section has enough pitfalls to justify a dedicated page (otherwise inline `<Callout>`s)

**Exit criteria:** All section owners report done. `phase2_drafts_index.md` lists ≥1 non-empty page per section. No "TODO" stubs left in the content tree — every file has real prose.

---

## Phase 3: Synthesis (1 agent, serial)

Synthesis can't be parallelized across sections because the whole point is cross-cutting. Spawn ONE agent with broad context — it reads every `phase1_notes/*.md` and every page in `content/`, then writes:

- `content/index.mdx` — the landing page. Hero + `<Cards>` to each top-level section.
- `content/overview/what-is-this.mdx` — one-paragraph elevator pitch + longer narrative.
- `content/overview/architecture.mdx` — system diagram (mermaid), major components, how they fit together.
- `content/overview/data-flow.mdx` — end-to-end trace from a user action (or input) through the system to output/persistence.
- `content/overview/contributing.mdx` — how to set up a dev environment, run tests, where to start reading, commit conventions. Must cite paths that actually exist in the source repo.
- `content/overview/glossary.mdx` — seed glossary; Phase 5 will expand and harmonize.

**The synthesis agent also updates `_meta.global.tsx`** at the site root to establish top-level ordering (Overview → each section → Reference → Contributing). See [NEXTRA.md](NEXTRA.md#_meta-file-global) for format.

**Exit criteria:** Overview pages exist and read as a coherent narrative arc. Running `./scripts/content-lint.mjs content/` reports zero "missing intro" / "no example" failures on the overview tree.

---

## Phase 4: Polish (PARALLEL, repeat until marginal)

Spawn one polisher per section. Each gets the [Phase 4 prompt](AGENT-PROMPTS.md#phase-4--polisher-parallel-repeat-until-marginal) and the [Polish Bar rubric](../SKILL.md#the-polish-bar-non-negotiable). The polisher's job is to answer, per page:

- Does the intro orient a reader who lands cold on this URL?
- Is motivation (WHY this exists) clear before the HOW?
- Is there a mental model (diagram / sketch)?
- At least one runnable concrete example?
- Pitfalls / gotchas / common mistakes called out?
- "Beyond the basics" tips where applicable?
- Cross-links to related pages? (Nothing is a dead end.)

Polishers may add `<Callout>`, `<Steps>`, `<Tabs>`, `<FileTree>`, `<Cards>`, `<details>` blocks, and mermaid diagrams. They should log changes to `phase4_polish_log.md` with the section and a one-liner per page edited.

### Termination rule

After each full polish pass across all sections, the main agent evaluates the log:

- If this pass added ≥1 substantive change (new diagram, new gotcha, rewritten intro, new example) to ≥10% of the pages → run another pass.
- If this pass only did typo / wording tweaks → Phase 4 is done.
- **Minimum 2 passes.** Maximum typically 4; stop earlier if marginal.

**Exit criteria:** A pass produces only trivial changes, AND at least 2 passes have been done.

---

## Phase 5: Glossary, Index, and Fresh-Eyes Harmonization (1 agent)

One agent does the final content sweep before we turn to framework plumbing:

1. **Expand glossary**: every domain term used in `content/**` gets a definition in `content/overview/glossary.mdx`. Use `<dl>` or a table. Cross-link from first use on each page (Phase 5 agent must grep to find first uses).
2. **Index** (if repo is big enough to need one): `content/reference/index.mdx` listing every public API / command / type with a one-line description and link to its page.
3. **Contradiction sweep**: the agent reads every page and flags places where two pages say inconsistent things (different default values, different command names, different types). Fixes in the canonical page, updates all others.
4. **Terminology harmonization**: pick one term when the code uses synonyms (e.g., "handler" vs "controller", "config" vs "settings"). Decision goes in the glossary.
5. **Broken-link pass**: run a link checker (see `scripts/content-lint.mjs`) on all in-repo links.

**Exit criteria:** Glossary has an entry for every term on the first-use list. No contradictions in the log. Link checker green.

---

## Phase 6: Nextra-ify (repeat until marginal)

Up to here the work has been *content*, stored as MDX that would render fine even in GitHub. Phase 6 is where we unlock Nextra's advanced features and make the site look polished.

### Pass 6a: framework scaffolding (once)

- Ensure `<site-dir>` has `app/`, `mdx-components.tsx`, `next.config.ts`, `package.json`, `tsconfig.json`, `postcss.config.mjs`. If the site was initialized by `scripts/scaffold-nextra.sh`, these already exist.
- Wire `app/layout.tsx` with `<Layout>` + `<Navbar>` + `<Footer>` + `<Banner>`.
- Configure `<Layout>` props: `editLink`, `feedback`, `lastUpdated`, `toc={{ float: true }}`, `sidebar={{ defaultMenuCollapseLevel: 1 }}`, `darkMode`, `docsRepositoryBase` pointing at the source repo.
- Generate/refresh `_meta.global.tsx` from the current `content/` tree using `scripts/generate-meta.mjs`. Preserve any hand-edited ordering by reading the existing `_meta.*` file first.
- Add `<title>` + metadata to `app/layout.tsx` from the source repo's `README.md` / `package.json`.
- Install dependencies: `bun install` (or `pnpm install`).
- Run `bun run build` — must succeed. Fix any MDX-syntax errors reported.

### Pass 6b: component uplift (parallel per section, repeat until marginal)

Polishers upgrade plain MDX to use Nextra components:

- Code fences → add `filename=`, `{line-ranges}`, `/substrings/`, `showLineNumbers` where useful.
- Long "step 1 / step 2" narratives → `<Steps>`.
- Choice narratives ("if X, do A; if Y, do B") → `<Tabs>`.​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌
- Directory trees shown as code blocks → `<FileTree>`.
- Landing / section-index pages → `<Cards>` grid.
- Architecture + sequence diagrams → mermaid fenced blocks.
- Callouts where appropriate (`info`, `warning`, `error`, `important`). Don't overdo — one per section max.
- Replace `console.log("npm install...")` code fences with `npm2yarn`-tagged fences.
- Per-page theme overrides in `_meta` where appropriate (e.g., landing page may want `layout: 'full'`, changelog may want `typesetting: 'article'`).

Same termination rule as Phase 4: stop when a full pass produces only trivial tweaks.

### Pass 6c: build again

- `bun run build` — green.
- Run `bun dev` in the background, use the `/ui-polish` and `/ux-audit` skills (if available) to run a visual pass.
- Capture screenshots of dark + light mode home, one deep page, and the search overlay and describe them in `phase6_nextraify_log.md`.

**Exit criteria:** Build is green. Dark mode works. Search returns results. `_meta.global.tsx` matches the content tree. Polish pass ran clean.

---

## Phase 7: Fresh Eyes & Bug Hunt

Three explicit review prompts, run by *separate* fresh agents. The main agent runs them one at a time and merges findings, then re-runs the loop until two consecutive review rounds produce only trivial edits.

**Prompts (verbatim, give to three separate agents):**

1. "great, now I want you to carefully read over all of the new code you just wrote and other existing code you just modified with \"fresh eyes\" looking super carefully for any obvious bugs, errors, problems, issues, confusion, etc. Carefully fix anything you uncover."
2. "I want you to sort of randomly explore the code files in this project, choosing code files to deeply investigate and understand and trace their functionality and execution flows through the related code files which they import or which they are imported by. Once you understand the purpose of the code in the larger context of the workflows, I want you to do a super careful, methodical, and critical check with \"fresh eyes\" to find any obvious bugs, problems, errors, issues, silly mistakes, etc. and then systematically and meticulously and intelligently correct them. Be sure to comply with ALL rules in AGENTS.md and ensure that any code you write or revise conforms to the best practice guides referenced in the AGENTS.md file."
3. "Ok can you now turn your attention to reviewing the code written by your fellow agents and checking for any issues, bugs, errors, problems, inefficiencies, security problems, reliability issues, etc. and carefully diagnose their underlying root causes using first-principle analysis and then fix or revise them if necessary? Don't restrict yourself to the latest commits, cast a wider net and go super deep!"

**After each round, run:**
```bash
bun run build             # must be green
bun run typecheck         # (script alias for `tsc --noEmit`) must be clean
ubs <site-dir>            # if available; fix issues
```

**Exit criteria:** Two consecutive review rounds produce only trivial edits (typo, wording), *and* build + typecheck + linters are green. Log each round + outcome to `phase7_review_log.md`.

---

## Phase 8: Deploy

Default path: **Vercel**. Self-hosted `bun start` is the fallback.

### Vercel path

Use the `/vercel` skill if available. Otherwise:

1. If user doesn't have `gh` auth'd, walk them through `gh auth login`.
2. Create a GitHub repo for the site directory (private by default; ask):
   ```bash
   gh repo create <org>/<repo>-docs --source=. --private --push
   ```
3. If user doesn't have `vercel` CLI, offer `bun add -g vercel` (or `npm i -g vercel`) and `vercel login`.
4. Link and deploy:
   ```bash
   vercel link
   vercel --prod --yes
   ```
5. Report the production URL to the user.
6. If the user wants a custom domain, use `vercel domains add` and give them the DNS records.

See [DEPLOY.md](DEPLOY.md) for troubleshooting (build command override, Node version pinning, Pagefind postbuild path).

### Self-host path

1. `bun run build`
2. `bun start` (or `next start`) binds to `:3000`.
3. If the user wants static export, we switch `next.config.ts` to `output: 'export'`, rebuild; the `out/` directory is the static site — point any web server at it.

**Exit criteria:** The user has a URL. Main agent loads it with `curl -I` and confirms `200 OK`. If Vercel, also verify the deployment status is `READY` via `vercel ls`.

---

## Phase 9: E2E Smoke (Playwright)

Use the `/e2e-testing-for-webapps` skill if available for Playwright plumbing. Minimal checks, no login required:

- Home page loads; `<title>` matches expected.
- Search: open search, type a known term, assert ≥1 result.
- Dark mode toggle: click, assert `<html>` has `class="dark"`.
- Navigate to one deep page; assert heading matches `_meta` title.
- Open one page with a mermaid diagram; assert `<svg>` is rendered.
- Mobile viewport (375×667): assert hamburger menu opens sidebar.
- Visual: screenshot home (light + dark) and one deep page; save to `phase9_screenshots/`.

**If the user skipped Vercel and self-hosted**, run Playwright against `http://localhost:3000` with `bun dev` in background.

**Exit criteria:** Smoke test passes. Screenshots archived.

---

## Phase 10: User-Lens Pass

A *fresh* agent (no prior context of the doc site's construction) acts as a first-time reader:

1. Give it the URL only.
2. Ask it to spend 15 min "using" the docs as if adopting the library.
3. Have it open `/idea-wizard` (if available) to generate improvement ideas; otherwise use this prompt:

   > You are a senior engineer evaluating `<project>` for adoption. Spend time reading these docs. Then produce:
   > - 5 things that are clear and well-done
   > - 5 things that are confusing, missing, or make you lose confidence
   > - 3 concrete rewrites you'd suggest
   > - 1 "biggest gap" that would most improve onboarding

4. File the output to `phase10_user_lens.md` in the workspace.
5. **Do not implement these as part of the run.** Create one GitHub issue per suggestion so the user can prioritize in follow-up. Apologize for nothing — a clean "docs shipped, here are improvements queued" is better than a bloated turn-7 run.

**Exit criteria:** `phase10_user_lens.md` exists; follow-up issues filed; run formally complete.​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍

---

## Run-level exit summary

At the very end, the main agent posts a summary to the user:
- Production URL
- Total pages written
- Build size (from `bun run build` output)
- Phase logs location
- Follow-up items from Phase 10
- "Next command to re-polish": `@documentation-website-for-software-project Phase 4 again on <section>`

---

## Phase-to-operator mapping

Each phase invokes specific operators from [OPERATOR-LIBRARY.md](OPERATOR-LIBRARY.md). This table is the index.

| Phase | Operators applied | Reference |
|-------|-------------------|-----------|
| 2 — Draft | `★ ORIENT` + `✦ MOTIVATE` + `◐ MENTAL-MODEL` + `⬡ EXEMPLIFY` + `⚠ WARN` + `⇄ CROSS-LINK` on every page | [Polish Bar](../SKILL.md#the-polish-bar-non-negotiable) |
| 3 — Synthesis | `⊕ SYNTHESIZE` (composed of other operators) | [OPERATOR-LIBRARY § ⊕ SYNTHESIZE](OPERATOR-LIBRARY.md#-synthesize) |
| 4 — Polish | any operator where the page fails rubric; termination on `⌘ REDUCE` + trivial-only rounds | [OPERATOR-LIBRARY](OPERATOR-LIBRARY.md) |
| 4 (all pages) | `⊙ DE-SLOP` at the end of each pass | [OPERATOR-LIBRARY § ⊙ DE-SLOP](OPERATOR-LIBRARY.md#-de-slop) |
| 5 | `⇄ CROSS-LINK` (glossary terms), `⤵ DECOMPOSE` if oversized pages discovered | [OPERATOR-LIBRARY](OPERATOR-LIBRARY.md) |
| 6b | `⊞ NEXTRA-UPLIFT` per page | [OPERATOR-LIBRARY § ⊞ NEXTRA-UPLIFT](OPERATOR-LIBRARY.md#-nextra-uplift) |
| 7 | adversarial — any operator, driven by bugs found | — |

`scripts/audit-content.mjs` (run between phases) reports per-operator coverage. Phase 4 termination requires ≥95% coverage on required operators for each page type (see [OPERATOR-LIBRARY.md § Operator composition cheat-sheet](OPERATOR-LIBRARY.md#operator-composition-cheat-sheet)).

---

## Per-phase failure modes and recoveries

| Phase | Failure mode | Recovery |
|-------|--------------|----------|
| 0 | Partition too coarse — a subfolder's work lumped into a parent | Repartition; re-spawn the affected section agent |
| 0 | Project type misclassified (picked Rust library when it's a CLI) | Re-run partition with explicit `--project-type` hint |
| 1 | Agent returns rushed notebook (missing headings) | Re-run with prompt emphasizing required headings; cite missing ones |
| 1 | Agent hallucinated APIs in the notebook | Phase 1 exit gate should catch via file:line citation validation — reject and re-run |
| 2 | Draft has TODO/`{{placeholder}}` left in | Content-lint P7 fails — reject and re-run `⬡ EXEMPLIFY` on affected pages |
| 2 | Code examples use fake identifiers | Content-lint doesn't catch this directly — fresh-eyes Phase 7 will. Better: tighten Phase 2 prompt |
| 3 | Synthesis page re-states section content | Re-run with prompt: "Your job is NOT to re-explain each section. Connect them. Add what only appears when you see the whole." |
| 3 | Architecture mermaid diagram wrong-direction arrows | Fresh-eyes catches; fix and re-run content-lint |
| 4 | Polish pass only does whitespace/typo edits from round 1 | Either drafts were good (success!) or polisher is lazy — re-prompt with higher-substance requirements |
| 4 | Polish introduces AI-slop (emdashes, "Here's why") | Apply `⊙ DE-SLOP` at end of each pass, not as a standalone phase |
| 5 | Glossary has entries for non-used terms | Grep all content/ for each glossary term; remove orphaned entries |
| 5 | Contradiction sweep missed a contradiction | Cross-referenced by Phase 7 random-walk prompt; file if found |
| 6a | `bun run build` fails with MDX parser error | Read error message — usually unclosed JSX or nested fences. Fix surgically |
| 6a | `bun install` fails | Check Node version (needs 18+, ideally 22); check for `node_modules` left from a prior attempt |
| 6b | Over-component-izing | Reduce per-page heuristic: at most one `<Callout>`, one `<Cards>`, one `<Steps>` per page |
| 6c | Dark mode contrast fails | Check custom CSS; Nextra default theme passes WCAG AA — reverting custom styles usually fixes |
| 7 | Fresh-eyes keeps finding the same bug | The bug is in source code — file via `gh issue create` or the GitHub connector |
| 7 | Termination never triggers | Cap at 4 rounds; diminishing returns. Ship and file follow-ups |
| 8 | Vercel build fails: "Cannot find module 'nextra'" | Project root set wrong — `vercel link` from the site dir, not parent |
| 8 | Deploy succeeds but search empty | Pagefind postbuild didn't run; check `public/_pagefind/pagefind.js` in Vercel build logs |
| 9 | Playwright timeout on dev server | Wait for readiness before running: `until curl -s http://localhost:3000; do sleep 1; done` |
| 9 | Axe reports critical a11y violations | Delegate to `subagents/a11y-auditor.md`; don't ship until zero critical |
| 10 | User-lens agent's findings contradict each other | Normal — file as follow-ups and let user resolve priorities |

Full troubleshooting catalog: [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

## Phase checkpoints — measurable exit criteria

Each phase writes snapshots to `.docs_workspace/` (see [MEASUREMENT.md](MEASUREMENT.md) for schemas). The main agent reads them to decide "am I done with this phase?":

| Phase | Artifact | Hard gate |
|-------|----------|-----------|
| 0 | `partition.json` | User approved partition |
| 1 | `phase1_notes/<section>.md` × N | Every section has a notebook with all required headings |
| 2 | `phase2_drafts_index.md` | ≥1 non-empty `.mdx` per section; no TODOs left |
| 3 | `phase3_synthesis_log.md` | All 6 overview pages exist; overview content-lint green |
| 4 | `phase4_polish_log.md` | Two consecutive rounds all `[trivial]`; ≥2 rounds total |
| 5 | `phase5_broken_links.md` + `phase5_contradictions.md` | In-repo broken links 0; glossary complete |
| 6 | `phase6_nextraify_log.md` + `bun run build` | Build green; first-load JS < 100 KB |
| 7 | `phase7_review_log.md` | Two consecutive full trios `[trivial]` only; build + typecheck green |
| 8 | `phase8_deploy.json` | `deploy_status == "READY"`; URL 200 |
| 9 | `phase9_smoke_results.json` | All Playwright tests pass; axe critical = 0 |
| 10 | `phase10_user_lens.md` | Report written; follow-ups filed |
