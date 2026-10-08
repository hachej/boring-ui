# Boring UI

Build an AI assistant into your application with chat, document editors, canvas viewers and background tasks. Boring UI provides TypeScript libraries and React components around the native Pi runtime. Your application owns authentication, data, permissions and model credentials.

**0.2.0 release candidate.** This is a breaking replacement for the 0.1.x implementation. The seven packages remain private while release qualification is pending. Read the [migration guide](MIGRATING.md) before upgrading. “v4” names the architecture, not the npm version.

## What you can build

- **An assistant beside your app.** Connect your tools and context to chat, notifications and document viewers inside your existing interface.
- **A coding workspace.** Give an agent files, optional Bash and Git, chat and editors over a shared workspace.
- **A background assistant.** Run native tasks with questions, validation and delivery without mounting a chat interface.

Editors and viewers also work without an agent. Choose the packages and entry points your application needs.

## Packages

All seven packages target **0.2.0**. These are the proposed npm names; publication is still pending.

| Package | What it provides | Guide |
| --- | --- | --- |
| `@hachej/boring-ui-kit` | Headless controllers, React chat, document editors, canvas and custom viewers | [UI](packages/ui/README.md) |
| `@hachej/boring-agent` | Native Pi integration, application tools, questions, delivery and authenticated transports | [Agent](packages/agent/README.md) |
| `@hachej/boring-files` | Workspace providers, conditional document writes, revision history and remote access | [Files](packages/files/README.md) |
| `@hachej/boring-execution` | Virtual Bash and Git, and remote execution adapters | [Execution](packages/execution/README.md) |
| `@hachej/boring-browser` | Optional native Pi agent execution in a browser worker | [Browser](packages/browser/README.md) |
| `@hachej/boring-feedback` | In-app feedback capture and host-controlled delivery | [Feedback](packages/feedback/README.md) |
| `@hachej/boring-testing` | Test helpers for hosts and package consumers | [Testing](packages/testing/README.md) |

The headless UI root has no files, Pi or agent dependency. Select optional resource and Pi entry points when you need them. The [feature map](docs/implementation/FEATURES.md) links public APIs to their tests and known limits.

## Try the fictional morning demo

Use **Node.js 22.19.0 or later**. From a checkout of this 0.2.0 candidate:

```bash
npm ci
npm run build
npm run morning
```

Open **http://127.0.0.1:3000**. The example prepares fictional email, calendar and todo documents through native tasks. Edit a reply, review proposed changes and try the Send, Snooze, Slot and Tick actions. Send writes to a fictional outbox; it sends no email.

For an existing-app example, stop the morning server and run:

```bash
npm run redaction:browser
```

The [fictional consultation guide](examples/redaction-browser/README.md) covers notes, human corrections, letter adoption and preparation views. Use fictional data when exploring these examples.

## Integrate with your application

1. Start with the [UI guide](packages/ui/README.md) for controllers and renderers, or the [native composition examples](examples/native-compositions.ts) for Pi integration.
2. Supply your application's authentication, storage and authorization. Bind file access to one workspace provider and use conditional writes for documents that need revision checks and recovery.
3. Add the chat and viewers your interface needs. Controllers have explicit lifetimes; a component can borrow a controller without owning its teardown.
4. Use the [shadcn registry recipes](registry/README.md) to copy components into your application for customization. That guide covers registry setup, dependencies and installation checks.

Pi owns conversations, tools, task execution and recovery. Boring uses its public APIs and borrows the native Harness. Your host retains policy, budgets and credentials. See [Pi integration and composition](docs/architecture/PI-COMPLEMENT.md) for the ownership boundaries.

## Release status

The repository contains working implementations and tests for document publication and recovery, chat, editors, canvas, background tasks, remote adapters and installed component recipes. Passing an individual test does not qualify every provider or deployment.

Global release proofs, live-provider checks, consumer acceptance and optional dependency licensing still have outstanding qualifications. Packages remain private until the release gates pass. The [implementation checkpoint](docs/implementation/PARTIAL.md) records the remaining work; [VERIFY.json](VERIFY.json) owns the proof status.

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

`check:pack` audits real package tarballs. `verify` reports deferred proofs; `verify:release` rejects them. Browser journeys and isolated consumer checks run separately in CI. Raw local evidence belongs in `.cache/evidence/`.

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
