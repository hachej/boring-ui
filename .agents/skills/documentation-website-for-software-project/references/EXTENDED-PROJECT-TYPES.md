# Extended Project Types‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

[PROJECT-TYPES.md](PROJECT-TYPES.md) covered the common archetypes (Rust lib/CLI, Python lib/web, TS lib/CLI/monorepo, Go, SPA, backend, IaC, ML, polyglot). This file covers 10 more that come up often enough to deserve their own partition template.

Use the same pattern-matching approach from Phase 0: detect signals in the source repo, pick the template, record the choice in `phase0_project_type.md`.

---

## Embedded / firmware (C/C++, Rust for microcontrollers)

**Signals:** `Cargo.toml` with `#![no_std]`; `platformio.ini`; `zephyr.yml`; Makefiles with `-mcpu=`; hex/bin output artifacts.

**Audience:** mostly contributors and advanced operators. End-users are other firmware engineers.

**Partition:**
```
content/
  index.mdx
  overview/
    what-is-this.mdx
    architecture.mdx                 # Memory map, interrupt model, task scheduler
    contributing.mdx
    glossary.mdx
  hardware/
    supported-boards.mdx             # Target hardware catalog
    pinout.mdx
    peripherals.mdx
  build/
    toolchain.mdx                    # Cross-compilation setup
    flashing.mdx                     # Debugger / OpenOCD / J-Link
    debugging.mdx
  concepts/
    memory-model.mdx
    interrupts.mdx
    power-management.mdx
  reference/
    registers.mdx                    # MMIO register reference
    hal-api.mdx
  guides/
    <task>.mdx                       # How to read a sensor, blink an LED, etc.
```

**Emphasize:**
- Memory maps (addresses, sizes) in tables.
- Pinout diagrams (SVG or mermaid).
- Timing diagrams for interrupt sequences.
- Explicit mention of `#[no_std]` / freestanding context.
- Power budgets and flash/RAM usage.

**What to grep:**
- `#[interrupt]`, `#[entry]` macros → entry points.
- Register definition macros (`register!`, `svd2rust`-generated).
- Linker scripts (`.ld` files) → memory layout documentation.

---

## Kubernetes operator / CRD-based controller

**Signals:** `config/crd/`; `PROJECT` file (from kubebuilder); `controller.go` / `controller.rs`; Helm chart; OperatorHub manifest.

**Audience:** cluster operators, platform engineers, SREs.

**Partition:**
```
content/
  index.mdx
  overview/
    what-is-this.mdx                 # What kind of resources does this manage
    architecture.mdx                 # Controller/reconciler/webhook diagram
  install/
    helm.mdx
    kustomize.mdx
    operator-lifecycle-manager.mdx
  crd-reference/
    <CRD>.mdx                        # Per-CRD: spec / status / examples
  guides/
    <task>.mdx                       # How to create, update, delete resources
  operations/
    monitoring.mdx                   # Metrics endpoint, Grafana dashboards
    troubleshooting.mdx
    backup-restore.mdx
  concepts/
    reconciliation.mdx
    finalizers.mdx
    admission-webhooks.mdx
```

**Emphasize:**
- YAML examples that are kubectl-apply-able.
- Mermaid sequence diagrams for reconciliation loops.
- Status-field tables for each CRD.
- Metric names with PromQL example queries.
- RBAC requirements.

**What to grep:**
- `type <Name> struct` with `metav1.TypeMeta` / `metav1.ObjectMeta` → CRDs.
- `func (r *<X>Reconciler) Reconcile(...)` → reconciler entry points.
- `kubebuilder:` markers → validation rules → reference tables.
- Webhook registrations → admission policy docs.

---

## Database engine / storage system

**Signals:** WAL implementation; B-tree or LSM-tree code; query planner; `.wal` or `.sst` files; ACID guarantees in README.

**Audience:** advanced operators, integrators building on top, performance-conscious developers.

**Partition:**
```
content/
  index.mdx
  overview/
    what-is-this.mdx                 # Positioning vs sqlite/postgres/rocksdb
    architecture.mdx                 # Layers diagram (parser → planner → executor → storage)
    guarantees.mdx                   # ACID, isolation levels, durability claims
  concepts/
    query-execution.mdx
    transaction-model.mdx
    storage-format.mdx               # On-disk layout, endianness, page format
    indexing.mdx
    write-path.mdx                   # Journaling, WAL, fsync semantics
  reference/
    sql-dialect.mdx                  # What SQL is supported, divergences
    pragmas.mdx                      # or: config options​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
    error-codes.mdx
    wire-protocol.mdx                # if networked
  guides/
    embedding.mdx                    # Using as a library
    operations.mdx
    backup-restore.mdx
    performance-tuning.mdx
  internals/
    developer-guide.mdx
    testing.mdx                      # Fuzzing, jepsen, etc.
  concepts/adr/
    <decision>.mdx                   # Why B-tree not LSM; why not async I/O; etc.
```

**Emphasize:**
- Precise ACID claims. "Durable on fsync" vs "durable on disk".
- Disk-format docs with hex dumps.
- Benchmark tables with methodology.
- Consistency model diagrams (for distributed DBs).
- SQL dialect differences vs standard.
- ADRs — storage engines are full of decisions people will ask about.

**What to grep:**
- Page / block / cell struct definitions → storage format reference.
- `CREATE INDEX`, `JOIN` keywords in parser → dialect scope.
- Transaction state machines → transaction reference.
- Error code enums → error-code reference.

---

## Protocol / specification (RFC-style)

**Signals:** Document-heavy repo (`.md`, `.txt`, LaTeX, AsciiDoc), little-to-no code, formal grammar files (`.abnf`, `.ebnf`), version specs.

**Audience:** implementers of the spec, auditors.

**Partition:**
```
content/
  index.mdx
  overview/
    abstract.mdx                     # One-paragraph summary
    rationale.mdx                    # Why this spec exists
    scope.mdx                        # What's in / out of scope
  conformance/
    requirements.mdx                 # MUST / SHOULD / MAY levels
    test-vectors.mdx
  syntax/
    grammar.mdx                      # ABNF / EBNF / BNF
    encoding.mdx                     # Serialization format
  semantics/
    <behavior>.mdx                   # For each rule, its meaning
  security/
    threat-model.mdx
    cryptography.mdx
  implementations/
    reference-impl.mdx
    test-harness.mdx
  changelog.mdx                      # Versioned spec evolution
```

**Emphasize:**
- Numbered sections for citation (`§3.2.1`).
- Exact RFC 2119 keyword usage (MUST / SHOULD / MAY).
- Test vectors with expected outputs.
- Conformance checklists.
- Formal grammar in a single canonical page.
- Errata pages.

**What to grep:**
- RFC 2119 keywords in existing docs → convert to callouts.
- Tables of constants / magic numbers.
- Version labels (`v1.0`, `v1.1`) in headings.

---

## Browser extension

**Signals:** `manifest.json`; `background.js` / `service_worker.js`; `content_scripts`; Chrome Web Store / Firefox Add-ons listing.

**Audience:** end-users (adoption), contributors (extension devs).

**Partition:**
```
content/
  index.mdx
  install/
    chrome.mdx
    firefox.mdx
    edge.mdx
    safari.mdx                       # Usually different story
  features/
    <feature>.mdx                    # User-facing feature walkthrough
  privacy/
    permissions.mdx                  # Explicit list, why each
    data-collection.mdx              # What's collected, where it goes
  contribute/
    local-build.mdx                  # `web-ext run` / `pnpm dev`
    manifest-v3.mdx                  # if relevant
    architecture.mdx                 # content / background / popup separation
  troubleshooting.mdx
  changelog.mdx
```

**Emphasize:**
- Screenshots of every feature (and for each supported browser).
- Permission rationale prominently — users are suspicious.
- Privacy policy inline, not just linked.
- Keyboard shortcuts table.
- Supported versions matrix.​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

**What to grep:**
- `chrome.*` / `browser.*` API calls → document what the extension does.
- `"permissions": [...]` in `manifest.json` → privacy page seed.

---

## Mobile app (iOS / Android / React Native / Flutter)

**Signals:** `Info.plist` / `AndroidManifest.xml`; `Podfile`; `pubspec.yaml`; React Native `app.json`.

**Audience:** end-users (support), contributors (developers).

**Partition:**
```
content/
  index.mdx
  user-guide/
    <feature>.mdx
  install/
    ios.mdx
    android.mdx
  privacy/
    permissions.mdx
    data-handling.mdx
  accessibility.mdx                  # VoiceOver / TalkBack behavior
  contribute/
    local-development.mdx            # Xcode / Android Studio / react-native run
    architecture.mdx
    state-management.mdx
  troubleshooting.mdx
  changelog.mdx
```

**Emphasize:**
- Screenshots and screen recordings — docs for apps are visual.
- Platform-specific tabs for iOS vs Android behavior.
- App Store / Play Store review note (what Apple/Google want to see).
- Keyboard navigation / switch control accessibility.

---

## Game engine / game

**Signals:** Unity `.csproj` + `Assets/`; Unreal `.uproject` + `Source/`; Godot `project.godot`; custom engine with asset pipeline code.

**Audience:** game designers (content creators), engine contributors, plugin authors.

**Partition:**
```
content/
  index.mdx
  overview/
    what-is-this.mdx
    architecture.mdx                 # Engine subsystems: render / physics / audio / input / scripting
    performance-philosophy.mdx       # Frame budget, allocation discipline
  getting-started/
    first-scene.mdx                  # Tutorial: scene with a cube
    scripting.mdx
  subsystems/
    rendering.mdx
    physics.mdx
    audio.mdx
    input.mdx
    networking.mdx
  scripting-api/
    <class>.mdx                      # Per-class reference (engine-side API)
  editor-guide/
    scene-editor.mdx
    inspector.mdx
    hotkeys.mdx
  asset-pipeline/
    importers.mdx
    formats.mdx
  plugins/
    authoring.mdx
    marketplace.mdx                  # If there's a plugin marketplace
  optimization/
    profiling.mdx
    memory.mdx
    gpu.mdx
  platforms/
    <target>.mdx                     # Console / mobile / web-specific notes
```

**Emphasize:**
- Frame budget tables (target 16ms / 33ms).
- Video walkthroughs of editor workflows (see [INTERACTIVE.md](INTERACTIVE.md)).
- Visual asset import pipelines.
- Coordinate systems, handedness, units — these matter.
- Platform-specific gotchas (mobile memory, console certification).

---

## Scientific computing / research library (numpy/scipy-style)

**Signals:** `pyproject.toml` with numpy/scipy deps; Jupyter notebooks; `examples/` with `.ipynb`; paper citations in README.

**Audience:** researchers, data scientists, ML engineers.

**Partition:**
```
content/
  index.mdx
  overview/
    what-is-this.mdx
    theory.mdx                       # Mathematical foundation (cite papers)
    comparison.mdx                   # vs alternatives (scikit-learn, JAX, torch)
  install.mdx
  tutorials/
    <scenario>.ipynb rendered as mdx # Executable research notebooks
  user-guide/
    <topic>.mdx                      # Common analyses
  api-reference/
    <module>/
      <function>.mdx                 # Auto-generated docstrings
  examples/
    <paper-reproduction>.mdx         # Reproducing published results
  developer/
    contributing.mdx
    benchmarks.mdx
    numerical-considerations.mdx
```

**Emphasize:**
- LaTeX math (`latex: true`).
- Plots — pre-generated (matplotlib → PNG) on every concept page.
- Citations to papers inline.
- Computational complexity noted for every algorithm.
- Reproducibility: exact seeds, versions, platforms.
- Jupyter notebook → MDX rendering (see [INTERACTIVE.md](INTERACTIVE.md)).

**What to grep:**
- `def` with `numpy.ndarray` return types → API reference.
- `@numba.jit` / `@cython.boundscheck(False)` → perf-critical paths.
- `doi:` in comments → paper citations.

---

## Standards body / working group docs (W3C-style)

**Signals:** Multi-stakeholder repo, many contributors from different orgs, `decisions/` or `meetings/` folders, `CHARTER.md`.

**Audience:** member organizations, implementers, the public.

**Partition:**
```
content/
  index.mdx
  charter.mdx                        # Mission, scope, membership​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
  governance/
    process.mdx
    ip-policy.mdx
    voting.mdx
  specs/
    <standard>.mdx                   # One per standard (may link to full spec)
  working-groups/
    <wg>.mdx                         # Per-WG page
  meetings/
    <date>.mdx                       # Minutes archive
  adoption/
    implementations.mdx              # Who ships what
    conformance-suite.mdx
  participate/
    become-a-member.mdx
    public-review.mdx
    join-a-wg.mdx
```

**Emphasize:**
- Historical record intact — meetings are dated and immutable.
- Member organization logos (with consent).
- Status tables (Draft / Candidate / Standard).
- Decision trails — who decided what, when, why.
- Implementation conformance dashboards.

---

## Blockchain / smart contract protocol

**Signals:** Solidity `.sol` files; `hardhat.config`; `foundry.toml`; audit reports in `audits/`; deployed contract addresses.

**Audience:** protocol users, integrators, auditors, the curious.

**Partition:**
```
content/
  index.mdx
  overview/
    what-is-this.mdx
    economic-design.mdx              # Tokenomics / fee model
    security-model.mdx               # Threat model, audit summaries
  technical/
    architecture.mdx
    contracts/
      <Contract>.mdx                 # Per-contract: addresses, ABI, events
    upgrade-mechanism.mdx
    oracles.mdx
  integrations/
    <language>.mdx                   # Client libraries (ethers.js / web3.py / etc.)
    indexers.mdx                     # The Graph / Subsquid
  guides/
    <workflow>.mdx
  security/
    audits.mdx                       # Links to audit PDFs
    bug-bounty.mdx
    incident-response.mdx
  governance/
    voting.mdx
    proposal-process.mdx
  changelog.mdx                      # Upgrades + deployment history
```

**Emphasize:**
- Deployed contract addresses with network (mainnet / testnet / chain ID).
- ABI tables and event schemas.
- Audit reports front-and-center.
- Gas cost tables.
- Multi-chain support matrix.
- Incident history, transparent.

**What to grep:**
- `pragma solidity`; `contract`; `event`; `function ... public` → public API.
- Deployment scripts → addresses.
- `.sol` natspec (`@notice`, `@dev`, `@param`) → reference seed.

---

## Updating the pattern-matching checklist

Extend the Phase 0 checklist from [PROJECT-TYPES.md](PROJECT-TYPES.md) with:

| Signal | Template |
|--------|----------|
| `#![no_std]` or `platformio.ini` | Embedded/firmware |
| `PROJECT` file + `config/crd/` | Kubernetes operator |
| WAL + B-tree/LSM in source | Database engine |
| Heavy `.md`/`.txt` docs, minimal code, formal grammar files | Protocol / spec |
| `manifest.json` with `content_scripts` | Browser extension |
| `Info.plist` or `pubspec.yaml` or RN `app.json` | Mobile app |
| Unity/Unreal/Godot project files, or asset pipeline code | Game engine |
| Jupyter notebooks + scipy/numpy deps + paper citations | Scientific computing |
| Multi-org CONTRIBUTING, meetings/ folder, CHARTER.md | Standards body |
| Solidity `.sol` + `audits/` + deployed addresses | Blockchain protocol |

Record the pick in `phase0_project_type.md` with a one-line justification.

---

## When none of these fit

Some projects don't match any archetype. That's fine — fall back to the generic template from [PROJECT-TYPES.md § Polyglot](PROJECT-TYPES.md#polyglot--multi-component-projects-eg-frontend--backend--cli) and customize.

If the new archetype is going to come up repeatedly (e.g., you're building docs for 5 similar projects in a row), add a new section to this file following the established pattern: signals, audience, partition, emphasis, grep list.
