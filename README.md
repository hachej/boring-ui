# Boring UI

This is the breaking `1.0.0` candidate of the v4 architecture. Read the
[migration guide](MIGRATING.md) before upgrading from the previous packages.

Composable application capabilities around native Pi: chat, extensible viewers with agent tools, versioned resources, optional durable application features and coherent working-environment adapters. Keep the host's application and Pi's full native engine. Add only the pieces needed.

**Status: partial implementation. Tested increments include transactional documents, native tools/questions/delivery, Markdown/chat/HTML controllers and renderers, canvas controls, virtual Bash/Git, authenticated Fetch adapters and installed shadcn recipes. Browser, provider, experience and full acceptance qualifications remain incomplete.** See the [implementation checkpoint](docs/implementation/PARTIAL.md) for exact evidence and remaining qualifications.

## Packages and runtime entries

For npm artifact checks and remaining publication gates, see [Prepare an npm release](docs/implementation/NPM-RELEASE.md).

Seven private npm workspaces expose compiled contracts and optional runtime entries under `packages/{files,agent,execution,ui,browser,feedback,testing}`; `browser` is the opt-in agent worker for a browser tab (BORING-PI-5). Native FileSystem/Shell/ExecutionEnv and native execution/view types are aliases of the published Pi package, not copied interfaces. [SCAFFOLD.md](docs/contracts/SCAFFOLD.md) lists exports and pending work; [examples/native-compositions.ts](examples/native-compositions.ts) shows compile-checked host wiring.

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run verify
```

Contracts use `import type`. The [feature map](docs/implementation/FEATURES.md) links public runtime entries to executed tests and their limits. The [UI guide](packages/ui/README.md) documents concrete controllers and renderers; the [registry guide](registry/README.md) covers local source installation. The six global runtime proof obligations still block release.

### Refined composition boundaries

The headless `@hachej/boring-ui-kit` root is independent of files, Pi and agent packages; optional `/resources` and `/pi` entry points add those integrations. Controllers and renderers compose separately. Workspace inputs are host-defined and recovery is an additional capability. Native tool APIs, environment factory and ConversationWatch remain exact upstream contracts. [The audit](docs/contracts/ABSTRACTION-REVIEW.md) records corrected scaffold mistakes and [the guide](docs/contracts/SCAFFOLD.md) describes current exports.

### Incremental implementation and exact build output

Specialized viewer controllers retain their methods through feature registration. Native filesystem-only, shell-only and combined leases remain distinct. Runtime packages land with their own public-output tests; full system qualification stays deferred and release-blocking. Builds clean only validated package dist directories so deleted source cannot remain in the packed output. [Composition checks](docs/contracts/COMPOSITION-CHECKS.md) records this pass and its evidence boundaries.

### Current delivery plan

The [roadmap](docs/architecture/ROADMAP.md) now begins with a thin browser-free resource/native test and grows the editor, background agent and remote coding compositions independently. The [current hub owner map](docs/compatibility/HUB-M1.md#current-consumer-ownership) follows hub revision 6; Factory development is separate. Historical IDs/evidence remain intact and A48 adds current hub acceptance. Remote security, recovery, draft/privacy and measured performance requirements are documented, not implemented by this update.

## Three applications, one library

| Use case | Composition |
| --- | --- |
| Remote coding agent | Native Pi tools/tasks plus one acquired workspace; file and shell interfaces share it; reviewed publication and optional evidence/chat are separate additions. |
| Embedded background agent | Native tasks and typed app services with optional questions/validation/delivery; no browser, chat, filesystem or sandbox required. |
| Assistant beside an app | Native conversation plus host tools/context, chat and selected viewers/resources; existing router, auth, database and UI remain. |

Resources/viewers also work without an agent. Composition is ordinary TypeScript and explicit ownership, not a mode hierarchy, plugin engine or generic replacement runtime. [PI-COMPLEMENT.md](docs/architecture/PI-COMPLEMENT.md) describes the recipes and failure cases.

## What Boring adds—and reuses

Pi retains conversations, tools, scheduling, dynamic child graphs, steering, forks, compaction, recorded usage and recovery. The host retains direct native APIs. Boring borrows a Harness; an optional convenience setup owns only what it creates.

Reuse Pi's public FileSystem/Shell/ExecutionEnv for working environments. Boring's resource contract adds expected revisions and publication evidence, not another low-level filesystem: every file lives in a workspace and is read and conditionally written through that workspace's one provider (`createWorkspaceProvider` over disk, the virtual workspace or SQLite rows; [one place for files](docs/architecture/FILES-GIT-EXEC.md#one-place-for-files)). The AWS recipe of it ([examples/aws](examples/aws/README.md)) is built and proven offline; its live deployment is still pending. Temporary build files need no domain receipt; publishing an approved document is a separate conditional effect. File-only tools need no dummy shell; composed native files and execution cannot point at unrelated machines.

Portable headless state/actions/tools power both human viewer controls and native agent adapters. Add a custom viewer or provider without changing the engine. Browser-only commands bind a live instance; saved-resource tools work without an open viewer. Mature v2 chat interactions and v3 viewer/shadcn recipes are deliberate port targets.

Use just-bash/isomorphic-git over one selected virtual working view; optional code mode reuses upstream pi-codemode. Use tldraw for the selected canvas and json-render for declared layout composition. These are optional capabilities, not mandatory runtimes or permission grants. Generated content never installs executable plugins.

## Fictional morning example

Run `npm run build` and `npm run morning`, then open `http://127.0.0.1:3000`.
The example prepares email, calendar and todo documents through native tasks. Its cells use their owning services for Snooze, Send, Slot and Tick. Send queues a fictional outbox record; it sends no email. The Markdown reply stays outside the generated decisions region. Regenerate offers a layout; adoption is local, and Pin/Keep require a publication receipt.

`npm run morning:journey` runs the authenticated Chromium journey. `npm run test:morning-consumer` tests packed libraries in an isolated installation. See the [checkpoint](docs/implementation/PARTIAL.md#fictional-morning-experience-candidate-2026-10-08) for qualification limits.

## Read

For the fictional consultation workflow, run `npm run redaction:browser` after building. The [example guide](examples/redaction-browser/README.md) covers exact notes saves, source-mode dictation, human corrections, explicit record/letter adoption and a typed six-section preparation experience. `npm run redaction:journey` and `npm run redaction:preparation:journey` drive its Chromium controls; `npm run test:redaction-browser-consumer` exercises an isolated package installation.

| Document | Purpose |
| --- | --- |
| [Project invariants](INVARIANTS.md) | Native authority, owned lifecycles, optional features, independent surfaces and coherent workspace views. |
| [Pi complement and compositions](docs/architecture/PI-COMPLEMENT.md) | What Boring adds, public native reuse and the three reference applications. |
| [Product requirements](docs/architecture/PRODUCT-REQUIREMENTS.md) | Full P01–P14 scope. |
| [Architecture](docs/architecture/SPEC.md) | Ownership, packages, host authority, working resources and presentation. |
| [Contract vocabulary](docs/contracts/CONTRACTS.md) | Native attachment, resource/publication, decisions, views, viewer tools and environment binding. |
| [Files, Git and execution](docs/architecture/FILES-GIT-EXEC.md) | Native working interfaces versus resource guarantees, coherent acquisition and optional execution. |
| [Website and registry integration](docs/architecture/WEBSITE-INTEGRATION.md) | Existing apps, mature chat, custom viewers, styles and actual shadcn installation. |
| [Legacy UI ledger](docs/compatibility/LEGACY-UI.md) | Pinned v2/v3 port behavior and deliberate corrections. |
| [Experiences](docs/architecture/EXPERIENCE.md) | Cells and fixed/derived/generated layout composition. |
| [Canvas](docs/architecture/CANVAS.md) | tldraw document/session split, assets, styles and license qualification. |
| [Native examples](docs/architecture/UPSTREAM-EXAMPLES.md) | Pi patterns, pinned seams and bounded executed probes. |
| [Redaction study](docs/stress-tests/REDACTION.md) | Existing-app compatibility blockers and mapping. |
| [Evidence baseline](docs/stress-tests/BASELINE.md) | What was actually run and what remains unproved. |
| [Hub proposal](docs/stress-tests/HUB-FACTORY.md) | Broader consumer input, not automatic defaults. |
| [Accepted Hub M1](docs/compatibility/HUB-M1.md) | Portable obligations, host invariant specializations and qualification prerequisites. |
| [Acceptance](docs/acceptance/ACCEPTANCE.md) | A01–A47 required future journeys; no implemented-runtime claim. |
| [Roadmap](docs/architecture/ROADMAP.md) | Composed delivery lanes and launch-packet reconciliation. |
| [Law index](docs/LAWS.md) | Owners and limits of evidence. |

## Verify the specification and boundaries

```bash
npm ci --ignore-scripts
npm run check          # document links, law registry and bounded source/dependency policy
npm test               # tooling tests, including structural composition-policy fixtures
npm run verify         # registered evidence; runtime deferrals remain visible
npm run verify:release # intentionally fails while required runtime proofs are pending
node scripts/probe-redaction.mjs ../boring-clinic-redaction
# Optional: isolated just-bash@3.6.0 + isomorphic-git@1.42.6 installation
node scripts/probe-vfs-git.mjs /path/to/isolated-dependencies
```

The redaction probe requires that app/dependencies and uses invented input. The VFS probe uses disposable in-memory storage and denies native processes; it is not an authorized/durable publication provider. Structural tests do not establish native capability parity, browser integration, live sandbox qualification or expert acceptance. Raw evidence stays ignored under `.cache/evidence/`. No production, private patient data or credentials belong in test fixtures.
