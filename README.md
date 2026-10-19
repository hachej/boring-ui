# Boring UI

Build an AI assistant into your application with chat, document editors, canvas viewers and background tasks. Boring UI provides TypeScript libraries and React components around the native Pi runtime. Your application owns authentication, data, permissions and model credentials.

**0.2.0 release candidate.** This is a breaking replacement for the 0.1.x implementation. Five packages (agent, ui-kit, files, execution, feedback) are published; boring-browser and boring-testing stay private. Per the owner ruling of 2026-10-10, deferred proofs are backlog, not release blockers. Read the [migration guide](MIGRATING.md) before upgrading. “v4” names the architecture, not the npm version.

## Shipping an app

Apps live in Cloudflare Artifacts git repos and ship through the [Factory](https://github.com/hachej/boring-factory/blob/main/docs/PROVISIONING.md) (signed artifact, cloud verify, live pointer), starting from its `templates/app`. Boring UI provides the npm packages and shadcn registry blocks that template consumes via a vendor release.

## What you can build

- **An assistant beside your app.** Connect your tools and context to chat, notifications and document viewers inside your existing interface.
- **A coding workspace.** Give an agent files, optional Bash and Git, chat and editors over a shared workspace.
- **A background assistant.** Run native tasks with questions, validation and delivery without mounting a chat interface.

Editors and viewers also work without an agent. Choose the packages and entry points your application needs.

## Packages

All seven packages target **0.2.0**. Five are in the publish set; browser and testing stay private. Nothing is published yet; publication awaits the owner checklist in the release guide.

| Package | What it provides | Guide |
| --- | --- | --- |
| `@hachej/boring-ui-kit` | Headless controllers, React chat, document editors, canvas and custom viewers | [UI](packages/ui/README.md) |
| `@hachej/boring-agent` | Native Pi integration, application tools, questions, delivery and authenticated transports | [Agent](packages/agent/README.md) |
| `@hachej/boring-files` | Workspace providers, conditional document writes, revision history and remote access | [Files](packages/files/README.md) |
| `@hachej/boring-execution` | Virtual Bash and Git, and remote execution adapters | [Execution](packages/execution/README.md) |
| `@hachej/boring-browser` | Optional native Pi agent execution in a browser worker | [Browser](packages/browser/README.md) |
| `@hachej/boring-feedback` | In-app feedback capture and host-controlled delivery | [Feedback](packages/feedback/README.md) |
| `@hachej/boring-testing` | Test helpers for hosts and package consumers | [Testing](packages/testing/README.md) |

A single authenticated `revisionProvider` powers a frontend file tree, filename search for `@`, uploads and retained revision previews. See the [file tree guide](packages/ui/README.md#file-tree-and-filename-mentions).

The headless UI root has no files, Pi or agent dependency. Select optional resource and Pi entry points when you need them. The [feature map](docs/implementation/FEATURES.md) links public APIs to their tests and known limits.

## Try the fictional morning demo

Use **Node.js 22.19.0 or later**. From a checkout of this 0.2.0 candidate:

```bash
npm ci
npm run build
npm run morning
```

Open **http://127.0.0.1:3000**. The example prepares fictional email, calendar and todo documents through native tasks. Edit a reply, review proposed changes and try the Send, Snooze, Slot and Tick actions. Send writes to a fictional outbox; it sends no email.

Use fictional data when exploring these examples.

## Integrate with your application

1. Start with the [UI guide](packages/ui/README.md) for controllers and renderers, or the [native composition examples](fixtures/native-compositions.ts) for Pi integration.
2. Supply your application's authentication, storage and authorization. Bind file access to one workspace provider and use conditional writes for documents that need revision checks and recovery.
3. Add the chat and viewers your interface needs. Controllers have explicit lifetimes; a component can borrow a controller without owning its teardown.
4. Use the [shadcn registry recipes](registry/README.md) to copy components into your application for customization. That guide covers registry setup, dependencies and installation checks.

Pi owns conversations, tools, task execution and recovery. Boring uses its public APIs and borrows the native Harness. Your host retains policy, budgets and credentials. See [Pi integration and composition](docs/architecture/PI-COMPLEMENT.md) for the ownership boundaries.

## Install components

The shadcn registry ships inside `@hachej/boring-ui-kit` under `r/`, so each published version carries its own copy. Add components with the shadcn CLI (shadcn 3 or later).

**Version 0.2.2 (the current npm release).** Its items name their dependencies as `@boring-ui/<item>`, so map the namespace once in your application's `components.json`, pinned to the version you installed:

```json
{
  "registries": {
    "@boring-ui": "https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@0.2.2/r/{name}.json"
  }
}
```

Then add a component, for example the chat: `npx shadcn@latest add @boring-ui/pi-chat`. Items that need the shadcn tokens list `@boring-ui/theme` as a dependency and resolve it through the same pinned URL; `pi-chat`, `button`, `dock`, `feedback` and `app-shell` do not, see the [registry guide](registry/README.md).

**The next release.** Its items name their dependencies as absolute URLs of their own version, so no `registries` line is needed. Add an item by its URL, with the version you installed:

```sh
npx shadcn@latest add https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@<version>/r/theme.json https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@<version>/r/pi-chat.json
```

The `theme.json` item (the shadcn tokens) is needed only when the host does not define them already. `pi-chat`, `button`, `dock`, `feedback` and `app-shell` do not install it.

In either case the version in the URL must equal the installed `@hachej/boring-ui-kit` version. To upgrade, install the new npm version and re-add the components. `https://unpkg.com/@hachej/boring-ui-kit@<version>/r/<item>.json` also works. See the [registry guide](registry/README.md) for the available items.

The artifact panel also opens `*.mockup.html` as sandboxed HTML mock-ups with the app's theme and element comments. Hosts that forbid inline scripts need a separate sandbox origin. See the [mock-up viewer and CSP requirements](registry/README.md#html-mock-ups-mockup-viewer).

## Theming

Registry blocks support only shadcn Base UI `base-nova`. They compose your application's `@/components/ui/*` components without a separate control skin. Rebrand through your core theme tokens, following boring-stack's `boring-design-system` skill. Do not edit derived tokens or add per-block CSS overrides. `--shell` and `--overlay` are the documented kit-specific tokens.

The migration is staged. REPORT groups are remaining design debt, not conformance. See the [theming contract and design verification](registry/README.md#styling) for the boundary and evidence commands.

## Release status

The repository contains working implementations and tests for document publication and recovery, chat, editors, canvas, background tasks, remote adapters and installed component recipes. Passing an individual test does not qualify every provider or deployment.

Global release proofs, live-provider checks, consumer acceptance and optional dependency licensing still have outstanding qualifications. Deferred proofs are backlog and do not block release (owner ruling, 2026-10-10); publication waits on the owner checklist in the release guide. The [implementation checkpoint](docs/implementation/PARTIAL.md) records the remaining work; [VERIFY.json](VERIFY.json) owns the proof status.

The [npm release guide](docs/implementation/NPM-RELEASE.md) describes version synchronization, package ownership, trusted publishing and the manual publishing workflow. Merging a PR does not publish packages.

## Develop and verify

```bash
npm run check
npm run typecheck
npm test
npm run verify
npm run check:pack
npm run verify:release
```

`check:pack` audits real package tarballs. `verify` reports deferred proofs; `verify:release` still lists them but does not fail on them (backlog, not blockers); real failures still fail. Browser journeys and isolated consumer checks run separately in CI. Raw local evidence belongs in `.cache/evidence/`.

## Documentation

| Topic | Start here |
| --- | --- |
| Upgrade from 0.1.x | [Breaking migration](MIGRATING.md) |
| Implemented APIs and evidence | [Feature map](docs/implementation/FEATURES.md) and [implementation checkpoint](docs/implementation/PARTIAL.md) |
| Public contracts | [Contract guide](docs/contracts/SCAFFOLD.md) and [contract vocabulary](docs/contracts/CONTRACTS.md) |
| Ownership and architecture | [Invariants](INVARIANTS.md) and [specification](docs/architecture/SPEC.md) |
| Files and execution | [Workspace architecture](docs/architecture/FILES-GIT-EXEC.md) |
| Product scope and delivery | [Requirements](docs/architecture/PRODUCT-REQUIREMENTS.md), [roadmap](docs/architecture/ROADMAP.md) and [acceptance](docs/acceptance/ACCEPTANCE.md) |
| Existing-app compatibility | [Legacy UI](docs/compatibility/LEGACY-UI.md), [current hub ownership](docs/compatibility/HUB-M1.md#current-consumer-ownership) and [redaction study](docs/stress-tests/REDACTION.md) |
| Release preparation | [npm release guide](docs/implementation/NPM-RELEASE.md) |

## License

Boring UI is [MIT licensed](LICENSE). Optional dependencies retain their own licenses. In particular, qualify tldraw licensing and assets for your deployment as described in the [canvas guide](docs/architecture/CANVAS.md).
