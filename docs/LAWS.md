# Law index

This is an index, not a second definition. Project-wide Pi/composition boundaries live only in [INVARIANTS.md](../INVARIANTS.md); structural and pending runtime evidence is registered in [VERIFY.json](../VERIFY.json).

| ID | Owner | Current evidence |
| --- | --- | --- |
| BORING-PI-1 | Root INVARIANTS.md | Static namespace/class/import mutants; native authority, dynamic graphs and honest cancellation proof deferred. |
| BORING-PI-2 | Root INVARIANTS.md | Static construction mutants; borrowed/owned Harness/workspace/observer lifecycle and composition-local cleanup deferred. |
| BORING-PI-3 | Root INVARIANTS.md | Static replacement mutants; optional installation, locality and deliberate native-override parity deferred. |
| BORING-PI-4 | Root INVARIANTS.md | Public import/fork/patch/subclass/mutation mutants; native seam reuse and scoped guarantee behavior deferred. |
| BORING-PI-5 | Root INVARIANTS.md | Dependency/type-only mutants plus composition-policy fixtures; independent surfaces, three reference applications and browser bundle proof deferred. |
| BORING-PI-6 | Root INVARIANTS.md | Dependency mutants; same-view coherence, paired acquisition, separate private views and publication proof deferred. |
| SELF-1 | [packages/agent/README.md](../packages/agent/README.md#self-evolution) | Package prompt test: without `selfEvolving` nothing from `.agent/` is shown; journey `self-evolution`: a subagent has no `reload` and no agent section. |
| SELF-2 | [packages/agent/README.md](../packages/agent/README.md#self-evolution) | `npm run check` rule over `packages/` and `examples/` with mutants; journey: an agent-written tool sees none of the host's environment. |
| SELF-3 | [packages/agent/README.md](../packages/agent/README.md#self-evolution) | Package prompt-order test; journey: system context shows the host instructions, then the labelled agent section. |
| SELF-4 | [packages/agent/README.md](../packages/agent/README.md#self-evolution) | `npm run check` rule: only native `registry.install`/`uninstall`, with mutants; journey: write, reload, use, broken JSON, restart, rollback, `/reload`. |
| FEEDBACK-1 | packages/feedback/INVARIANTS.md | Runtime proof pending until feedback WP4 and WP9. |
| FEEDBACK-2 | packages/feedback/INVARIANTS.md | Runtime proof pending until feedback WP6 and WP9. |
| FEEDBACK-3 | packages/feedback/INVARIANTS.md | Runtime proof pending until feedback WP1 and WP4. |
| FEEDBACK-4 | packages/feedback/INVARIANTS.md | Runtime proof pending until feedback WP2 and WP5. |
| FEEDBACK-5 | packages/feedback/INVARIANTS.md | Runtime proof pending until feedback WP6 and WP9. Folder import rules and one-way edges by structural mutants; the WP7 agent-without-extension snapshot. |
| FEEDBACK-6 | packages/feedback/INVARIANTS.md | Runtime proof pending until feedback WP6 (host observations); late completions later. |
| FEEDBACK-7 | packages/feedback/INVARIANTS.md | Runtime proof pending until feedback WP6 and WP9. WP1 escaping and the WP7 show offers and feedback card outcomes are structural. |
| FEEDBACK-8 | packages/feedback/INVARIANTS.md | Runtime proof pending until feedback WP3, WP4 and WP9. |

Feature laws such as SELF-1..4 register their structural commands and their journey in [VERIFY.json](../VERIFY.json) `features`; `verify` runs the commands and lists the journeys, which run with the journey gates. EXPERIENCE-1..8 and CELL-1..4 remain owned by [EXPERIENCE.md](architecture/EXPERIENCE.md#laws), with their own proposed journeys. FEEDBACK-1..8 are owned by `@hachej/boring-feedback` ([its INVARIANTS.md](../packages/feedback/INVARIANTS.md)), registered through `VERIFY.json.packageLaws`; the design is in [FEEDBACK.md](architecture/FEEDBACK.md). Layout composition is not native task scheduling or application dependency composition. Implementation moves feature laws beside the package owner while preserving IDs; no root law is duplicated.

## Enforcement and its limits

`npm run check` checks ownership/index/registry, dependency policy and bounded shipped-source rules. `npm test` exercises positive cases and intentionally forbidden mutants, including `test/composition-policy.test.mjs` for direct browser-safe resource types and native filesystem type reuse. These are structural fixtures, not implemented exports, runtime behavior or API typechecking. Initial type-only library source now exists; see [SCAFFOLD.md](contracts/SCAFFOLD.md). Strict AST classification exempts only erased declarations from implementation applicability. Runtime/value/ambient stubs still require proofs; release remains blocked on actual pending obligations.

ARCHITECTURE.json retains a required runtime test slot for each root law. VERIFY.json distinguishes structural/runtime scope; removing a runtime record or relabelling static evidence cannot discharge that slot. Applicable behavior needs an executable contract proof, not placeholders. `verify` runs registered commands and reports pending obligations; `verify:release` fails on pending proofs. Package-local development evidence is now separate from unchanged global release qualification; see the development section below.

Tests exercise actual introduced surfaces. Injected fixtures may isolate external services, but do not become substitute implementations for the behavior being proved. Native parity includes custom configuration/tools, steering, forks, dynamic/background work, compaction and recovery before/after attachment. Resource conformance and provider qualification are separate from a consumer's business acceptance.

The AST checker does not establish arbitrary control/data flow, public API correctness, bundle contents or hidden competing state. Its aliases and prohibited forms are bounded structural evidence. Review maps each runtime responsibility to native Pi, host policy, working provider, publication authority or disposable presentation. Reusing native types does not certify matching runtime semantics.

## Concrete composition checks

The scaffold now tests generic callback variance, isolated tarball consumers, independent capability contracts and exact native factory/watch/tool reuse. The headless UI root and optional resource/native subpaths are separated without an agent type edge. These compile/package/native-assumption tests extend structural evidence; they do not discharge the pending runtime proof slots. Unsupported atomic publication must refuse before effects; unknown outcomes and lookup retention are not inferred from type shape.

## Development is not whole-system qualification

Runtime package source requires test/packages/<package>.test.mjs with declared Node tests and a direct public-package import. verify executes these tests with the same failure/no-skip/no-todo requirements as registered evidence. The import check does not prove coverage; reviewed assertions must exercise the implementation, not a surrogate. Existing global proof IDs, commands and release refusal remain. This replaces all-unrelated-proofs-before-any-code coupling without marking a deferral passed or adding another registry.

## Extending with host invariants

The hub specializes mechanisms with product policy: an exact approval adds a condition to publication; claims select business work; an inbox projects an original runtime question. Do not copy library law definitions into the hub, freeze native task graphs to match its business manifest or relabel old SQL/v3 tests as Git/v4 conformance. The pinned cross-repository map and negative cases are in [HUB-M1.md](compatibility/HUB-M1.md#hub-invariant-specializations). Changes here do not edit or certify hub code.

Composition-locality, lifecycle, namespace/view, no-authority-widening and honest-outcome tests extend existing BORING-PI slots and A40–A47. Reuse current registries and provider conformance fixtures; no new global invariant service, policy engine or verification framework.
