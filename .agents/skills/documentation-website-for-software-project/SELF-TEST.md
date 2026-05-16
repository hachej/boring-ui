# Self-Test

Trigger phrases that should activate this skill. If any of these fail to wake the skill, tighten the description in SKILL.md frontmatter.‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

## Should trigger

- "Generate a documentation site for `/data/projects/frankensqlite`"
- "Build Nextra docs for this project"
- "I want MDX documentation for this repo, deploy it to Vercel"
- "Make a docs site from my source code"
- "Create polished project documentation website"
- "Scaffold a Nextra docs site for `<GitHub URL>`"
- "Build a documentation site for this repo and deploy to Vercel"
- "Spin up docs for frankensqlite"

## Should NOT trigger​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌

- "Write a README for this project" → `/readme-writing`
- "Explore this codebase" → `/codebase-archaeology`
- "Produce an architecture doc for this repo" → `/codebase-report`
- "Optimize the docs site performance" → `/extreme-software-optimization` + this skill as follow-up
- "Migrate docs from Docusaurus" → not quite, could be handled; flag to the user it may need custom work

## End-to-end smoke on a tiny repo

Create a 2-file dummy repo:

```bash
mkdir -p /tmp/dummy-project/src
cat > /tmp/dummy-project/src/lib.rs <<'RS'​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌
/// Add two numbers.
pub fn add(a: i32, b: i32) -> i32 { a + b }
RS
cat > /tmp/dummy-project/README.md <<'MD'
# dummy-project
A two-function arithmetic library.
MD
cd /tmp/dummy-project && git init -q && git add -A && git commit -q -m "init"
```

Invoke the skill with: "Build a documentation site for /tmp/dummy-project, I don't need to deploy". Expected:

1. Skill asks up-front confirmations (site dir name, package manager, deploy target).
2. Agent runs Phase 0 partition: `src` is the only section.
3. Phase 1 produces `phase1_notes/src.md`.
4. Phase 2 produces `content/src/overview.mdx` and `content/src/lib.mdx` (or similar).​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
5. Phase 3 produces overview/index/architecture/contributing/glossary.
6. Phase 4 runs ≥2 polish passes.
7. Phase 5 produces glossary + link check.
8. Phase 6a runs `scaffold-nextra.sh`, `bun install`, `bun run build` — build is green.
9. Phase 6b uplifts at least one page to use `<Callout>`/`<Cards>`/`<Steps>`/mermaid.
10. Phase 7 runs three fresh-eyes rounds; build + typecheck + content-lint stay green.
11. Since deploy was declined, skill reports the local `bun dev` URL and skips Phase 8.
12. Phase 9 Playwright smoke runs against `http://localhost:3000`.
13. Phase 10 produces a user-lens report (may be terse for such a tiny project).

A site dir with fewer than ~8 MDX files in `content/` AFTER Phase 3 is a failure for this smoke test — the skill should still populate overview + one module page even for a 2-line library.
