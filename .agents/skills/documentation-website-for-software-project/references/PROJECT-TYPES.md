# Per-Project-Type Documentation Patterns‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

Different software shapes deserve different doc structures. This file catalogs the default partition, doc mix, and Nextra features to emphasize for each project archetype. During Phase 0, pattern-match on the source repo and apply the template most-closely matching.

---

## Rust — library / crate

**Typical source shape:** `src/lib.rs` + modules, `Cargo.toml`, `examples/`, `benches/`, `README.md`.

**Partition:**
```
content/
  index.mdx                          # landing: one-line pitch + Cards
  overview/
    what-is-this.mdx                 # Explanation
    architecture.mdx                 # Explanation + mermaid
    contributing.mdx                 # How-to
    glossary.mdx                     # Reference
  get-started.mdx                    # Tutorial: cargo add + first call
  guides/
    <common task>.mdx                # How-to (per major use-case)
  reference/
    <module>.mdx                     # Reference (via TSDoc-equivalent — see note)
  examples/
    <example>.mdx                    # Walk-through each `examples/*` file
  concepts/
    <design doc>.mdx                 # Explanation: traits, lifetimes choices
```

**Emphasize in Nextra:**
- `<Tabs items={['cargo add', 'Cargo.toml']}>` for install
- Mermaid for trait/type relationships
- Filename-tagged code blocks: ` ```rust filename="src/lib.rs" {10-20} `
- Auto-generated Rust API reference: `cargo doc` → host alongside Nextra site at `/rustdoc/`, link from Nextra reference pages
- KaTeX if the crate has any math

**What to grep for in Phase 1:**
- `pub fn` / `pub struct` / `pub trait` → public surface → Reference
- `#[derive(...)]` → patterns → Concepts
- `//!` crate-level docstring → use as seed for `what-is-this.mdx`
- `#[cfg(feature = ...)]` → feature gates → dedicated section in `guides/features.mdx`
- `examples/` → one page per file

---

## Rust — CLI tool (e.g., clap-based)

**Typical source shape:** `src/main.rs`, `src/cli/`, `src/commands/`.

**Partition:**
```
content/
  index.mdx
  install.mdx                        # Tutorial: curl|bash or cargo install
  get-started.mdx                    # Tutorial: first successful invocation
  commands/
    <command>.mdx                    # Reference per command (synopsis + flags + examples)
  guides/
    <workflow>.mdx                   # How-to: multi-command workflows
  configuration.mdx                  # Reference: env vars, config file
  concepts/
    <design>.mdx                     # Explanation: core design choices
  overview/contributing.mdx
  overview/architecture.mdx
```

**Emphasize:**
- ` ```sh npm2yarn ` → unused (Rust); use plain ` ```sh ` but show curl-pipe-bash, cargo install, brew install as `<Tabs>`.
- `<FileTree>` showing the config file layout
- ASCII output snippets (from real `--help` and `--version`)
- `<Steps>` for setup tutorials

**What to grep for:**
- `#[derive(Parser)]` / clap command macros → extract subcommand tree
- `clap::Command::new(...)` / `clap::ArgAction` → argument semantics
- `Config::from_file` / `env::var` → configuration sources
- `--help` text → already-written doc prose; mine it

---

## Rust — workspace / multi-crate

**Partition:**
```
content/
  index.mdx
  workspace/
    overview.mdx                     # Explanation: why this is a workspace, what each crate does​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
  crates/
    <crate-a>/
      overview.mdx
      api.mdx
    <crate-b>/
      ...
  guides/
    <cross-crate workflow>.mdx
```

**Emphasize:**
- Mermaid graph of crate dependency tree on `workspace/overview.mdx`
- `<Cards>` on `index.mdx` — one card per crate

---

## Python — library

**Typical source shape:** `pyproject.toml`, `src/<pkg>/`, `tests/`, `docs/`.

**Partition:**
```
content/
  index.mdx
  install.mdx                        # Tutorial: pip / uv / conda
  get-started.mdx                    # Tutorial: import + first call
  guides/
    <task>.mdx                       # How-to
  reference/
    <module>.mdx                     # Reference (consider mkdocstrings-style)
  concepts/
    <design>.mdx                     # Explanation
  overview/
    architecture.mdx
    contributing.mdx                 # pip install -e . + pytest
    glossary.mdx
```

**Emphasize:**
- `<Tabs items={['pip', 'uv', 'conda']}>` for install
- Typing: show type hints in examples
- Doctest-style examples: ` ```py ` with `>>>` prompts
- Filename tags: ` ```py filename="src/mypkg/core.py" `

**What to grep for:**
- `def ` at module top-level + docstring → Reference + seed prose
- `class ` → Reference
- `__all__` → curate Reference surface
- `@overload` → type variants

---

## Python — FastAPI / Flask / Django (web framework)

**Partition:**
```
content/
  index.mdx
  install.mdx
  tutorials/
    your-first-app.mdx
  guides/
    authentication.mdx
    testing.mdx
    deployment.mdx
  reference/
    routes.mdx                       # OpenAPI-driven if FastAPI
    models.mdx
    dependencies.mdx
  concepts/
    request-lifecycle.mdx
    async-vs-sync.mdx
```

**Emphasize:**
- Sequence diagrams (mermaid) for request flow
- OpenAPI JSON → auto-generate `reference/routes.mdx` via a build step
- `<Tabs>` for curl vs httpie vs Python client examples
- `<Callout type="warning">` for CORS / auth gotchas

---

## TypeScript — library

**Typical source shape:** `package.json`, `src/index.ts`, `tsconfig.json`.

**Partition:** same as Rust library, with these specifics:

**Emphasize:**
- `<TSDoc>` (see [ADVANCED-NEXTRA.md](ADVANCED-NEXTRA.md#1-tsdoc--api-auto-reference-generation)) for auto-generated API reference — this is the single biggest win for a TS library
- ` ```sh npm2yarn ` for install commands
- `filename="src/index.ts"` tags
- Playground / Sandpack for interactive examples (see [ADVANCED-NEXTRA.md](ADVANCED-NEXTRA.md#5-playground--interactive-code))

**What to grep for:**
- `export function` / `export class` / `export type` / `export interface` → Reference
- `/** */` JSDoc blocks → seed Reference descriptions
- `export *` barrel re-exports → resolve to real exports before documenting

---

## TypeScript — CLI (commander / yargs / oclif)

**Partition:** same as Rust CLI, but:

**Emphasize:**
- Install as `<Tabs items={['npm', 'pnpm', 'bun', 'yarn']}>` or `npm2yarn`
- If oclif: their topic/subcommand model maps naturally to the `commands/` tree
- Show both `--help` output and the programmatic API (if exposed) as `<Tabs>`

---

## TypeScript — monorepo (pnpm workspace / turbo / nx)

**Partition:**
```
content/
  index.mdx                          # Multi-package project landing
  packages/
    <package>/
      overview.mdx
      get-started.mdx
      api.mdx                        # <TSDoc /> per package
  guides/
    <cross-package workflow>.mdx​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌
  concepts/
    architecture.mdx                 # Mermaid: package dependency graph
```

**Emphasize:**
- One `<TSDoc>` page per public package
- Dependency graph mermaid on the architecture page
- `<FileTree>` showing the top-level monorepo layout
- Separate contributing.mdx that describes turbo/nx task orchestration

---

## Go — library or CLI

**Typical source shape:** `go.mod`, cmd entry points, `pkg/`, `internal/`.

**Partition:**
```
content/
  index.mdx
  install.mdx                        # go install / homebrew / binary download
  get-started.mdx
  commands/           # (if CLI)
    <command>.mdx
  guides/
    <task>.mdx
  reference/
    <package>.mdx                    # Link to pkg.go.dev, add conceptual overlay
  concepts/
    <design>.mdx
  overview/
    architecture.mdx
    contributing.mdx
```

**Emphasize:**
- Link heavily to https://pkg.go.dev/<module> for auto-generated godoc — don't duplicate
- Show `go get` + explicit version: ` ```sh\ngo get example.com/pkg@v1.2.3\n``` `
- Mermaid for goroutine/channel flow

**What to grep for:**
- `func (T) Method() ...` → exported methods → Reference
- `// Package X describes ...` in `doc.go` → seed Explanation
- `cmd/<name>/main.go` → CLI entry → Reference for `commands/`

---

## Frontend SPA (React / Vue / Svelte / Next.js app)

**Typical source shape:** `app/` or `src/`, `package.json`, `components/`, routing config.

**Partition:**
```
content/
  index.mdx
  get-started.mdx
  features/
    <feature>.mdx                    # How-to per user-facing feature
  architecture.mdx                   # Mermaid: rendering + data flow
  components/
    <component>.mdx                  # Reference + Storybook-style examples
  design-system.mdx                  # Explanation
  guides/
    theming.mdx
    testing.mdx
    deployment.mdx
```

**Emphasize:**
- Screenshots / video of the UI (docs for apps need visuals more than lib docs)
- Live component previews (embed an iframe or use Sandpack)
- Link to a Storybook if one exists

---

## Backend service (microservice, API server)

**Partition:**
```
content/
  index.mdx
  get-started.mdx                    # Run locally, make first request
  api/
    <endpoint>.mdx                   # Reference per endpoint, or OpenAPI auto-generated
  guides/
    authentication.mdx
    rate-limiting.mdx
    deployment.mdx
  concepts/
    architecture.mdx                 # Mermaid: service + dependencies
    data-model.mdx
  ops/
    runbook.mdx                      # How-to for on-call
    observability.mdx
```

**Emphasize:**
- OpenAPI / swagger-ui as the canonical API reference; Nextra site provides the narrative layer around it
- Sequence diagrams for request flow
- `<Callout type="important">` blocks for operational gotchas
- `<Tabs>` for curl vs. client-library vs. Postman collection

---

## Infrastructure / DevOps (Terraform, Pulumi, Ansible)

**Partition:**
```
content/
  index.mdx
  get-started.mdx                    # Bootstrap from zero
  modules/
    <module>.mdx                     # Reference per module/role
  guides/
    <task>.mdx                       # How-to (e.g., "Add a new environment")
  concepts/
    architecture.mdx                 # Mermaid: resource graph
    security-model.mdx
  runbook.mdx                        # How-to: common operational tasks
```

**Emphasize:**
- `<FileTree>` for IaC directory layout
- ` ```hcl filename="modules/network/main.tf" ` for Terraform
- Mermaid for resource dependency graphs (Terraform graph output can seed this)

---

## ML / data pipeline

**Partition:**
```
content/
  index.mdx
  get-started.mdx                    # Reproduce the headline result​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
  dataset/
    overview.mdx                     # Data sources, preprocessing
  model/
    architecture.mdx                 # Mermaid + math
    training.mdx
    evaluation.mdx
  inference.mdx
  concepts/
    <design choice>.mdx
  reproducibility.mdx                # How-to: seeds, environments, checkpoints
```

**Emphasize:**
- KaTeX for formulas (`latex: true`)
- Tables for evaluation metrics
- Mermaid for pipeline DAGs
- Link to W&B / MLflow / HuggingFace as cross-resources

---

## Polyglot / multi-component projects (e.g., frontend + backend + CLI)

Don't force everything into one mold. Use the partition step to split the repo into per-language sections, and let each section pick the template above.

**Partition (example):**
```
content/
  index.mdx                          # Hero + Cards to each sub-product
  overview/
    architecture.mdx                 # The unified system diagram
    data-flow.mdx                    # End-to-end request trace
  cli/                               # Rust CLI section (use Rust-CLI template)
    ...
  server/                            # Go server section (use Go service template)
    ...
  dashboard/                         # React frontend section (use SPA template)
    ...
  guides/
    full-stack-setup.mdx             # How-to that spans components
```

Cross-cutting concerns (auth, observability, deployment) can live in `guides/` at the top level rather than duplicated across components.

---

## Pattern-matching checklist (Phase 0)

Use this table to classify the source repo during partition:

| Signal | Template to pick |
|--------|------------------|
| `Cargo.toml` + `src/lib.rs` | Rust library |
| `Cargo.toml` + `src/main.rs` + `#[derive(Parser)]` | Rust CLI |
| `Cargo.toml` `[workspace]` | Rust workspace |
| `pyproject.toml` + `src/<pkg>/__init__.py` | Python library |
| `requirements.txt` + FastAPI/Flask/Django imports | Python web framework |
| `package.json` + `main` pointing at JS/TS | TS library |
| `package.json` + `bin` entry | TS CLI |
| `pnpm-workspace.yaml` / `turbo.json` / `nx.json` | TS monorepo |
| `go.mod` | Go (inspect for `cmd/` to classify as CLI) |
| `next.config.*` + `app/` or `pages/` | Next.js app |
| `package.json` + `vite.config.*` + `src/App.*` | Frontend SPA |
| `main.tf` / `*.tf` | Terraform |
| `openapi.{yaml,json}` | Backend API server |
| Mixed signals | Polyglot — partition into sub-projects |

Record the pick in `phase0_project_type.md` with a one-line justification.

---

## Cross-template conventions

Regardless of template, these always apply:

- `content/index.mdx` is a `<Cards>`-style launchpad, not a dense page.
- `content/overview/` holds the four synthesis pages (what-is-this, architecture, data-flow, contributing, glossary).
- `content/reference/` is austere; `content/concepts/` is opinionated.
- Every reference page has at least one example.
- Every how-to page has explicit prerequisites at the top.
- Every tutorial has a verification step after each meaningful action.

When adding a new project archetype, follow this file's pattern: section header, partition block, emphasis list, grep list.
