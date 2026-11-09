# D-2019 Ranger le dépôt: la carte

Docs only. Searched on origin/main (f220d51ee) in this repo, `boring-factory/main` and `fleet/apps` (read only). Key finding: boring-factory checks this repo out as `.boring-ui` and reads paths in it directly (`build/bundle/build.mjs` maps `@boring/ui/blocks/*` to `registry/`, `@boring/ui/shadcn/*` to `shadcn/ui/`; `platform-ui` and `tasks/ui` import `lab/studio/*`, `shared/local-host.mjs`, `examples/app-shell`, `scripts/css-stub-register.mjs`, `test/fixtures/*`, `packages/ui/styles/*`). Those paths cannot move without a factory PR, which this task may not make.

## One line per top-level folder or file

| Path | What it is | Who uses it | Verdict |
| --- | --- | --- | --- |
| `.agent-handoff/` | `d417/`: notes and screenshots of one finished task-board task (D-417) | one prose mention in `docs/implementation/FEATURES.md`; nothing runs it | delete (git history keeps it), fix the FEATURES.md sentence |
| `.github/` | 6 workflows (verify, release, studio-scripted, studio-smoke, platform-tasks, secrets) | CI | keep |
| `demos/` | `workspace/`: the one story demo (accounts-payable week), with a Cloudflare build | `package.json` `workspace-demo*` scripts, `verify.yml`, 7 tests, docs | merge into `examples/` later (`examples/workspace-demo/`), no outside consumer |
| `examples/` | 24 runnable single-feature or host recipes | factory reads `examples/app-shell`; `package.json` scripts, tests, docs | keep; becomes the one place for runnable pages (plus `lab/`) |
| `lab/` | `studio/`: playground over the standard agent, plus the Tailwind and scripted-model helpers | CI `studio-scripted.yml`, `scripts/check-design`, `test-design`; factory `platform-ui` and `tasks/ui` import `lab/studio/scripted-model.mjs`, `tailwind.mjs` | keep (consumer-pinned); the README says that it is the one playground and that `examples/` holds recipes |
| `features/` | feature map, one file per feature | `scripts/check-features.mjs`, AGENTS.md | keep |
| `fixtures/` | fictional data and fake hosts for tests and examples | tests, examples, `shared/` | keep; README clarifies against `test/fixtures` |
| `docs/` | specs, contracts, guides, per-task folders | everyone | keep; `docs/tasks/` is the home of task notes |
| `packages/` | the 7 published npm packages (agent, browser, execution, feedback, files, testing, ui) | npm consumers, factory | keep |
| `public/` | `r/`: 62 generated shadcn registry JSON files (`registry.json` + one per item), committed; `build-registry` writes them, `release-version` rewrites their pins; `packages/ui` ships them as `r/*.json` | apps run `shadcn add <url>/r/<item>.json` and `boring-ui-blocks`; factory resolves `boring-ui-kit/r/<item>.json` | keep, never touch without a registry build diff |
| `registry/` | source of the 204 registry blocks (`registry.json` lists the files) | shadcn CLI build, factory bundle (`@boring/ui/blocks/*`), apps copy it | keep |
| `registry.json` | root registry manifest | `build-registry`, shadcn CLI | keep (shadcn requires it at the root) |
| `scripts/` | 80 files: build, release, checks, 27 browser journeys and consumer tests, a few probes | `package.json`, CI, tests; factory uses `css-stub-register.mjs` | keep, prune 4 dead files (no caller), then group into subfolders only where no outside path is pinned |
| `shadcn/ui/` | 48 bundled shadcn primitive sources (Base UI recipes, compact defaults) | factory bundle (`@boring/ui/shadcn/*` and `@/components/ui/*` map to `shadcn/ui`), `check-mono`, 20+ contract tests, `registry/README.md` | keep (consumer-pinned). It is not the shadcn CLI: it is the kit's own primitives. Explain in README; only the empty-looking parent `shadcn/` has one child |
| `shared/` | 15 host helpers (standard agent, workspace/MCP tools, SQLite workspaces, canvas transport) imported by relative path | 20 examples, demos, 8 fixtures, lab; factory reads `shared/local-host.mjs` | keep; not a package, README already says so. Rename would break the factory |
| `skills/` | 6 agent skills shipped for people who build apps with the kit: `boring-ui` (entry point), `build-agent-app`, `add-blocks`, `app-layout-and-agent`, `agent-capabilities`, `boring-design-system` | factory `build-app` and `boring-app-template` skills load or copy them; `skills/boring-ui` links MIGRATING.md | keep; add `skills/README.md` with one line each |
| `test/` | all tests, plus `test/fixtures` (factory reads it) | CI | keep |
| `tools/` | one file, `feedback-voice-sync.mjs`, a manual Chromium measurement | `package.json` `feedback:voice-sync`, comments in `packages/ui` and `packages/feedback` sources, docs | move to `scripts/` (needs comment edits in two packages, see slice 6) |
| `MIGRATING.md` | 875 lines: `# Unreleased` plus one section per release back to the first | `release-version.mjs`, `release-notes.mjs`, `check-release-notes.mjs`, `release.yml` (GitHub release body), skills, factory `app-how-to.md` | trim: sections older than the last ~15 releases move to `docs/migrating/ARCHIVE.md`; `# Unreleased` untouched |
| `ARCHITECTURE.json`, `INVARIANTS.md`, `VERIFY.json`, `AGENTS.md`, `README.md`, `LICENSE`, configs | contract and tooling files | verify scripts | keep |

## Julien's questions

- lab vs examples vs demos: lab is the studio playground (factory imports it, so it stays), examples are recipes, demos is one story demo. Merge demos into examples; lab stays with a README line.
- public/r: the generated registry that apps fetch by URL. Keep.
- shadcn/ui: the kit's own primitives, consumed by the factory bundle by path. Keep, document.
- shared/: host helpers for examples and the factory's local host. Keep.
- skills/: shipped, factory-loaded. Keep; add the index.
- tools/: one script, fold into scripts/.
- scripts/: 4 files with no caller (`migrate-default-icons`, `probe-jev-live`, `probe-json-render`, `trace-journey`); the rest is called.
- .agent-handoff: finished-task leftovers. Delete.
- registry/: source of public/r; nothing to move.

## Slices (one PR each, safest first)

1. Delete `.agent-handoff/` (+ FEATURES.md sentence, verify-repo allowed list).
2. Delete 4 caller-less scripts (re-check callers incl. factory first; `trace-journey` helper, `migrate-default-icons` a finished one-off, two spike probes).
3. README: one line per top-level folder; `skills/README.md`, `shadcn/README.md`, lab/examples/demos wording. Docs only.
4. MIGRATING.md: move old released sections to `docs/migrating/ARCHIVE.md`, with the release scripts still passing (check `check-release-notes` on the diff).
5. Merge `demos/` into `examples/` (touches `package.json`, `verify.yml`, tests, `.gitignore`; wait for open PRs, #2137 touches the demo).
6. `tools/` into `scripts/` (comment-only edits in `packages/ui`, `packages/feedback` need an Unreleased line).
7. Group `scripts/` into `scripts/{release,check,journeys}` only for files with no pinned outside path (`css-stub-*` stay); last, biggest churn, likely skipped.

Not moved, on purpose: `registry/`, `public/r`, `shadcn/ui`, `shared/`, `lab/`, `examples/app-shell`, `test/fixtures`, `scripts/css-stub-*`, `packages/ui/styles`: boring-factory reads these paths.
