# Partial implementation checkpoint

## Document draft recovery

Branch `feat/draft-recovery-20261008` builds on npm preparation PR52. Four concrete
document controllers now accept optional host-owned draft storage. The
[UI guide](../../packages/ui/README.md#opt-in-document-draft-recovery) describes
the actions and limits. Public-output tests cover SQLite reopen, SIGKILL,
revocation, exact text, overlapping writers and late acknowledgements. The
isolated document consumer also executes the core recovery suite without Pi,
agent or React installed. Browser execution and final integration gates remain
pending until their actual results are recorded under `.cache/evidence/draft-recovery/`.

This is a partial implementation of the website recovery requirement. Durable
chat drafts, production storage policy and encryption remain separate work.
W00 remains reconciled, W01-W08/W10-W13 partial, and W09 a public-seam probe.
P01-P14, A01-A48, H01-H10 and all eleven global deferrals remain in scope.

## npm release preparation

The [npm release procedure](NPM-RELEASE.md) defines artifact checks and the remaining
publication gates. All seven packages now include repository metadata and the MIT
license. The UI package includes the embedded icon notices. The files package
declares its existing optional native type peers. `npm run check:pack` inspects
actual archives and all exports, including feedback and testing. CI and package
tests run this audit. Packages remain private at `0.0.0`; `release:preflight`
requires both release verification and publishable manifests. No global proof
deferral is removed, and no registry availability, scope ownership, or production
release is claimed. Evidence belongs under `.cache/evidence/npm-release/`.

## Remote canvas presentation, 2026-10-08

Branch `feat/remote-presentation-20261008` stacks on PR46 at `c362157`. It adds the [authenticated canvas host recipe](../architecture/CANVAS.md#authenticated-remote-presentation-recipe), explicit unknown presentation outcomes, native recovery tests, an installed consumer and a real browser journey gate. Independent review also reproduced retained abort listeners in the shared request guard; successful and refused reads now release them.

Focused source tests pass; final candidate and CI results are recorded under ignored `.cache/evidence/remote-presentation/` and copied to the requested checkout. Local browser execution is blocked by loopback EPERM. Do not infer browser qualification from bundle or injected Fetch tests. W00 remains reconciled, W01-W08/W10-W13 partial and W09 a public-seam probe. P01-P14, A01-A48 and H01-H10 remain in scope. Eleven global proofs remain deferred; this increment does not promote them.

## Mounted canvas commands, 2026-10-08

This increment adds inspect/select/frame to the optional native canvas renderer, preserving concrete native types and exact document/mount/page targets. It also removes a render-time owner mutation reproduced by a suspended controller replacement. See the [feature entry](FEATURES.md#mounted-canvas-commands) for public, native, installed and browser evidence commands, and the [canvas owner](../architecture/CANVAS.md#mounted-presentation-commands) for remaining qualifications.

The dedicated implementation branch stacks on PR40 at `c8a87d7`. Raw logs, independent review, exact commits and CI results belong under ignored `.cache/evidence/canvas-commands/`, with a resumable copy in the requested checkout. Local loopback is refused with EPERM; real browser claims require the separately executed CI journey. W00 remains reconciled; W01-W08/W10-W13 remain partial; W09 remains a public-seam probe. P01-P14, A01-A48 and H01-H10 remain in scope. Eleven global release proofs remain deferred; this increment does not promote any of them.


This is a resumable implementation record, not release approval. The full P01-P14 roadmap remains the objective. S0/S1 are increments within it.

## Current status notes (cleanup wave 1)

- Viewer tools are spec-required ([viewer feature and tool binding](../contracts/CONTRACTS.md#viewer-feature-and-tool-binding)). `@hachej/boring-agent/presentation` now binds an explicitly selected command and captured target to a native tool with per-call host authorization and explicit result projection. This direct adapter does not provide remote browser dispatch or mounted canvas commands. The Markdown buffer command is named `inspect_buffer` so it cannot be confused with Pi's native `read` of the saved file.
- `attachHarness` is a placeholder for BORING-PI-2: it returns the host's harness with a no-op `detach`, because attachment acquires nothing yet. It is named in the contract ([SCAFFOLD](../contracts/SCAFFOLD.md)) and kept; it is not runtime proof of the law.
- The chat transport projects every read: the watch, `?op=entries` history pages and `?op=submission` lookups all go through `access.project`; `?op=withdraw` calls the native `Harness.abortSubmission` bound by the host (`access.abortSubmission`). All HTTP handler factories read request bodies through `@hachej/boring-files/request-guard`. The watch heartbeats while idle and `@hachej/boring-ui-kit/remote-chat` reopens a lost stream itself; Node hosts bridge requests and responses with `@hachej/boring-files/node-http` (bounded body read; streamed response with backpressure and disconnect).
- Files live in one place ([One place for files](../architecture/FILES-GIT-EXEC.md#one-place-for-files)): every document, presented file and delivery output is a workspace file behind `createWorkspaceProvider` (disk, virtual or the SQLite backend). The separate SQLite resource store of `@hachej/boring-files/sqlite` was removed (files PR 8); a host with scopes opens one SQLite workspace per scope with its policy at the workspace boundary (`examples/shared/sqlite-workspaces.mjs`), and external consumers follow the migration note in the [files README](../../packages/files/README.md#migrating-from-the-removed-resource-store). Agents use Pi's `read`/`write`/`edit` behind the file guard, `bash` and `present`. The AWS recipe is built and proven offline only (`examples/aws`, `@hachej/boring-execution/aws-code-interpreter`; see [AWS Code Interpreter environment and host recipe](#aws-code-interpreter-environment-and-host-recipe-offline)); its live run against a disposable deployment (files PR 7) is pending an AWS account. Older sections below that describe the resource store, its random revisions or the document and artifact tools are history.
- Self-evolution ([SELF-EVOLUTION.md](../architecture/SELF-EVOLUTION.md)) is implemented in `@hachej/boring-agent` (`defineAgent({ selfEvolving: true, workspace })`) and on for the studio's local variant and the Cloudflare recipe; SELF-1..4 moved to the [agent README](../../packages/agent/README.md#self-evolution) with `VERIFY.json` `features` entries. Qualifications: the journey runs on the virtual variant only (Cloudflare is built, not journeyed, and has no person's `/reload`); "running calls finish on the old version" is Pi's registry behaviour, not retested; the no-`exec` report has no runtime proof (every studio variant has `exec`); SELF-2's check is bounded structural evidence (no data flow), backed by the host-environment journey; the factory's pull-request promotion is not built.
- The `pi-app` registry block (`AgentWorkspace`: sessions, chat, artifact viewers) is the studio's, the Cloudflare recipe's and `examples/workspace-app`'s page layout; its installed consumer (`npm run test:app-registry-consumer`) proves strict types and a browser bundle only, and its journeys (`workspace-app:journey`, the studio scenarios) are the browser evidence.
- Workspaces are resolved per call like Pi's environment ([Workspace per call](../architecture/FILES-GIT-EXEC.md#workspace-per-call)): the guard, `present`, the canvas tools, `working_git` and self-evolution take the workspace attached to the call's env (one host function), so the studio's `team` variant runs one agent on one harness for several fictional people, each with their own files, repository and agent-written tools, proven in two browsers (`npm run studio:journey:team`); `@hachej/boring-agent/harness-pool` is the per-owner alternative. The AWS recipe is one harness in one process for every user (its `env` gives each user's EFS folder and Code Interpreter session from one `createWorkspaceCache` entry, `npm run aws:journey`); the Cloudflare object attaches its one SQLite workspace to its env (`withWorkspace`) and its tools take it from there. After a restart, a team person's agent-written tools are installed when their workspace opens (the studio opens the workspaces of conversations with live work before resuming).
- Metering (`@hachej/boring-agent/metering`, [agent README](../../packages/agent/README.md#metering)) ports v2's reserve/record/settle/release contract onto native Pi with a host-owned scope (user, workspace, attributes) and a model-aware reservation (resolved model, native kind, message preview): reservation at submission admission, usage from the durable transcript, recovery from Pi's state after a restart (SIGKILL-tested), memory and SQLite ledgers, on in the studio's local variant. Qualifications: no per-model-call fence (Pi exposes none), subagent conversations and WhatsApp channel input are unmetered, no real-provider run, no balance badge in the UI.
- `@hachej/boring-ui-kit/chat` (`ChatPanel`) and the `chat` registry item were removed; `pi-chat` is the chat presentation. Older sections below that describe `ChatPanel` are history.
- Kept although nothing produces them yet, because the contract documents require them: publication `partial` results and `per-change` atomicity ([SCAFFOLD](../contracts/SCAFFOLD.md), [CONTRACTS](../contracts/CONTRACTS.md)), resource capability metadata, and `RecoverableWorkspaceProvider` / reattachment ([FILES-GIT-EXEC](../architecture/FILES-GIT-EXEC.md)).

## Base and integration constraints

The requested checkout has protected Git metadata at `04888ca6787b5f8bfa6350cc56b3174c3e756071`. GitHub inspection recovered and verified current main `8e452d65dcb046fd86e06ca18711bf2eaee15081`, one documentation commit later. Its exact blobs, tree and commit were imported into the isolated clone at `/tmp/boring-ui-v4-implementation-checkpoint`. The dedicated `implementation/roadmap-20261002` branch was rebased onto that main. Current owner documents were reread, and the requested workspace mirrors the implementation while preserving its protected Git directory. The unrelated existing change in `docs/stress-tests/HUB-FACTORY.md` is excluded from the isolated checkout. A GitHub connector publication attempt was denied because it requires approval and session policy is never. No remote tree, branch or PR was created. The verified local Git bundle preserves the dedicated branch.

The attachment at `/home/ubuntu/.codex/attachments/cea9f01b-7df3-4224-b472-2c1f4241259c/pasted-text-1.txt` repeats the implementation instructions. A separate `CODEX_OVERNIGHT.md` was not found. The historical packet is available at `origin/docs/overnight-implementation-package:docs/implementation/overnight/`; its preflight pins `5e421a2`. Current owner documents supersede its interfaces. Its stale preflight has not been claimed to pass, and none of its root files were merged.

The inspected delta adds exact native types, independent optional subpaths, concrete controller preservation, recursive test discovery, isolated consumers and package-specific runtime evidence. W00's development-gate work is already present at the inspected base. Broad global proof deferrals remain pending. Current main defines A48 as current-hub H10 at hub revision 6. H10 covers registry, invocation, identity, projections, applications and handoff; historical Factory-style H01-H09 remain separate. Neither set is qualified by these increments.

## Implemented increments

S0 provides SQLite published documents with binary bytes, retained revisions, conditional atomic batches and operation lookup. Authorization and duplicate identity are tested. Canonical argument digests carry an explicit version. Schema 1 fixture stores are refused without automatic migration. A real child-process kill after a SQLite mutation but before receipt insertion proves complete transaction rollback and retry without partial bytes. A host-created native Harness runs the document tool without a model or environment. Native task memo binds original publication identity. Real child processes are killed after resource commit and before native tool acknowledgement, then reopened to prove the original receipt/revision and refuse changed identity or revoked disclosure.

S1 provides the headless Markdown controller. Tests cover exact selected flush, absence-based creation, dirty conflicts, late acknowledgements, stale/disposed instances, lost acknowledgement reconciliation, malformed responses, invalid Unicode and receipt identity. Proposals retain their exact base and refuse implicit rebasing. Acceptance uses the existing exact flush and protects reentrant subscriber edits. Expiring inspection/proposal commands target the concrete viewer. Native saved-document patch tools use the same pure exact text transform and retain their input through native memo before publication. Patch crash recovery also covers revoked authorization and changed scope. No browser/editor/chat parity is claimed.

W03 now includes optional native single-choice questions and validated document delivery. Questions retain pending/resolved/expired/cancelled state in native session documents. Native tasks observe answers and expiry; authenticated resolution and consumption use caller-owned native commits. Delivery atomically binds a native producer and obligation, retains the pre-production target and identity, validates actual producer text and persists it before conditional publication. A missing recovery receipt defaults to unknown, with safe replay requiring explicit host qualification. String validation does not establish bounded model repair or tool evidence provenance. JavaScript callbacks must return an actual error array and literal current-subject approval; malformed truthy results refuse before effects.

W04 adds an authenticated Fetch/Web Streams adapter over an actual native conversation watch. Version 2 bounded snapshots and deltas expose only host-authorized retained text and native identifiers. Tests cover hidden fields, inherited-entry policy, three-stage authorization, strict boolean policy results, idle and in-flight revocation, backpressure, reconnect and independent watcher lifetime. Socket/browser authentication integration and remote commands remain unqualified.

`@hachej/boring-testing` moves the studio's scripted model, the fake chat model, the headless-Chromium driver, the idle proxy and the submit fault hook into one Node-only package (README journey run by `npm run test:testing-consumer`); it is test tooling, not a runtime qualification.

The public package tests are `test/packages/files.test.mjs`, `test/packages/agent.test.mjs` `test/packages/ui.test.mjs` and `test/packages/execution.test.mjs`. These are package and scenario evidence; they do not discharge the six global BORING-PI proof slots.

## Work and acceptance coverage

| Work | Current status | Product and acceptance scope |
| --- | --- | --- |
| W00 | Existing development gates retained; current-main reconciliation complete | No global qualification promoted |
| W01 | Borrowed handle and real native document tool tested | Partial P01/P10 and A01/A04/A33/A40; full native/transport parity pending |
| W02 | Transactional published-document reference implemented | Partial P07/P09 and A02/A06/A13/A16/A41; working filesystem and broader provider conformance pending |
| W03 | Native choice questions and document delivery tested | Partial P04/P10; bounded repairs, arbitrary host records and full background reference acceptance pending |
| W04 | Authorized native text projection and original-runtime question response tested through Fetch | Partial P02/P10; sockets/browser, inbox presentation, other commands and assets pending |
| W05 | Native chat controller, React composer, assistant Markdown and archived history implemented with public runtime and DOM tests | Partial P01/P02/P05/P06 and A44/A45; installed chat recipe tested; host-declared tool grouping and command mentions implemented; file/skill mentions, highlighting and browser journeys pending |
| W06 | Disposable shared native/Bash/local Git workspace implemented | Partial P07/P08/P09; scoped files/Git service, atomic path changes, durable overlays and remote work remain pending |
| W07 | Borrowed authenticated remote Shell and native FileSystem tested | P03/P09/P13; remote acquisition, protected verification and live provider qualification |
| W08 | Exact Markdown saves, proposals, target-bound commands, native patches and React/Tiptap renderer tested | Partial P05/P06/P11 and A11/A19/A42/A43; DOM controls, local caret retention and mounted inspect/select/heading commands implemented; tables/assets, remote command transport and browser journeys pending |
| W09 | Public seam probe only | P14; optional upstream code mode and A14/A22 |
| W10 | Partial | Canvas and HTML controllers/renderers; installed Markdown/chat/HTML recipes; browser, other custom viewers and SDK qualifications pending |
| W11 | Reference layouts, conditional Keep/Pin, native metadata composition and bounded generated regions implemented | Partial P12/A25-A29/A31; live evaluators, actions, browser and full A25-A32 pending |
| W12 | Partial | Fictional current-hub pinned execution, privacy/recovery, fixed cells and source-owned local issue handoff; browser/remote actions, external issue delivery/sharing and full redaction pending; fictional reservation/admission added below; full H01-H10 unqualified |
| W13 | Partial | Isolated document/editor consumers and development gates exercised; global qualification, browser journeys and release remain pending |

P01-P14 and A01-A48 remain in scope. No complete P, A or H obligation is marked passed by this checkpoint. H09, live providers, model quality, expert acceptance, licensing and release authorization require their own evidence.

## Reproduce the current increment

Build with `npm run build`. Run `node examples/document-editor.mjs` for a headless new-document/save/read demonstration with fictional content. It prints `saved`, `dirty: false`, the actual revision and persisted text. It is not a rendered editor demo.

Run the public behavior tests directly with `node test/packages/files.test.mjs`, `node test/packages/agent.test.mjs`, `node test/packages/ui.test.mjs`, `node test/packages/agent-questions.test.mjs` , `node test/packages/agent-delivery.test.mjs` and `node test/packages/agent-projection.test.mjs`. Run the four `test/contracts/*-crash.test.mjs` files for actual native SIGKILL scenarios. The increment has 64 passing public behavior tests and 18 passing SIGKILL cases. No model request or paid resource is used.

Run `npm run test:document-consumer` with a writable npm cache for actual tarball installation, strict TypeScript checking and SQLite save/read/lookup outside the monorepo, without Pi installed. Run `node examples/background-document.mjs` for a native question, producer, validator and document delivery demonstration. It resolves a fictional answer in trusted host code; remote human authentication remains unqualified.

Raw outputs are under ignored `.cache/evidence/implementation/`. The decision record is [decisions.tsv](decisions.tsv). Initial Node subprocess capture returned EPERM and native test isolation lost inner TAP output in this environment. Verification now uses file descriptors and Node's supported `--experimental-test-isolation=none` mode. Existing assertions, actual skipped-only rejection and mutation controls remain. npm subprocesses use an isolated writable cache. Capture checks its output limit after exit and bounds memory when reading; temporary disk usage can grow until the child exits or times out. This helper is for trusted verification commands, not untrusted command execution.

The first pre-rebase implementation commit was `2c7adcba9e6ce92d70c573b1588b80bc6b9b11e6`. Its `final-candidate/` run passed check/typecheck but exposed subprocess capture failures. The corrected pre-rebase candidate `b1fded2` passed check, typecheck, all 189 tests, verify, the isolated document consumer and both demos. Its separate release check failed only the six retained global deferrals. Those raw logs are under `final-b1fded2/`; they are historical evidence, not evidence for later source changes.

The reconciled `95e007f` candidate passed check, typecheck, all 192 tests, verify, the isolated consumer and both demos on a clean branch. Its separate release run failed only the same six global proof deferrals. Logs are under `final-95e007f/`. That candidate predates the conversation projection.

After reconciliation, the implementation commits are `9d138ca61d0c037f179ec52b30617efb40bb52a2` and `7f2c8df04f9976912e0327834c2d0cde1e7f080d`. The versioned-publication increment passes all 57 public and crash cases, including the inside-transaction kill. Candidate `721efa8b96befc453f82935270bd9f0dd6a49f0c` passed all 204 tests, check/typecheck/verify, the tarball consumer and all three demos with clean status before and after. Its separate release run retained the six deferrals. Raw logs are under `final-721efa8/`. This predates the proposal/patch increment. Candidate `86c105e` subsequently passed all 215 tests, check/typecheck/verify, the expanded tarball consumer and all three demos on a clean branch. Its separate release run retained the same six deferrals; logs are under `final-86c105e/`. Final candidate evidence names its exact tested commit in `commit.txt` and records clean status before and after. The ignored Git bundle preserves the dedicated branch for resumption.

An isolated Chromium launch failed with `setsockopt: Operation not permitted` and SIGTRAP. Registry metadata lookup failed with `EAI_AGAIN registry.npmjs.org`. Exact cached registry archives subsequently allowed the real editor dependencies to install with offline `npm ci`; missing metadata did not block this implementation. Browser journeys, installed shadcn and live provider claims remain deferred.

## Renderer increment

`@hachej/boring-ui-kit/markdown-editor` provides actual React/Tiptap rich/source controls over the existing concrete controller. It preserves exact initial bytes, borrows ownership, saves selected buffers and exposes proposal review, unknown reconciliation and explicit conflict discard. Its parser disables raw Markdown HTML per editor without mutating the host's Marked instance. Links are inert on click and no asset extension is installed. Public DOM tests cover the scenarios in `test/packages/ui-markdown-editor.test.mjs` with real SQLite publication, including GFM tables written unpadded, aligned, with inline code, links, escaped pipes and empty cells that open rich and save unchanged. This is DOM evidence, not browser qualification.

`npm_config_cache=/path/to/writable/cache npm run test:editor-consumer` packs files/UI, installs only the pinned editor dependency closure with offline `npm ci`, checks public declarations with `skipLibCheck: false`, repeats the DOM controls and builds an actual browser bundle. The consumer contains no Pi, Chord or agent package. Raw evidence is `editor-npm-ci.log`, `editor-consumer-retry.log` and the candidate gate directory. A first consumer attempt exhausted temporary filesystem inodes because it included unrelated lock entries; its log is retained. The corrected closure excludes them, and the disposable dependency probe was removed. Browser layout, caret, IME, table/asset preservation, shadcn and full editor parity remain open.

## Next work

Finish the current independent review and required checks. Remote publication needs a session where the authorized GitHub write can run; do not retry other write tools to bypass the approval-policy rejection. Continue remote decisions and client presentation, the pinned v3 editor and v2 chat behavior, and W03-W12. Read the owning legacy ledger before each port. Do not call the headless example full UI delivery. Use the existing dedicated implementation branch in the isolated clone; no changes are to be pushed to main.

Run `node examples/conversation-projection.mjs` for an authenticated fictional text snapshot and idle revocation. This uses in-process Fetch/Web Streams, not a deployed server or browser.

## Virtual workspace and consumer qualification increment

The optional execution runtime composes one public upstream storage instance with native read/write/edit tools, Bash and local Git. Fourteen public scenarios pass, including actual native ToolTasks, aliases/dangling symlinks, binary capture, lease isolation and a child process that refuses native process/network fallback. Native rename/truncate/flush, backing move/recursive directory copy and native streaming/spill/timeout requests explicitly refuse. Concurrent structural mutation, hard-link parity, Git writer serialization, durable overlays and scoped `@hachej/boring-files/git` operations remain unqualified. Run `node examples/virtual-workspace.mjs` after building.

The isolated virtual consumer installs the actual execution tarball and 205 pinned registry dependencies, then repeats public runtime tests and strict declaration checking. New consumer guards reject runtime dependency resolution outside the physical installation, including symlink escapes. TypeScript's actual declaration inputs and the editor browser bundle's actual inputs are checked too. This closes a qualification gap in earlier temporary consumers, which could see ancestor `node_modules` directories. Earlier logs remain historical evidence; guarded consumer runs supersede their dependency-isolation claim. A negative control proves that both direct and symlink escapes fail.

Focused evidence is under `.cache/evidence/implementation/virtual-*.log` and `consumer-isolation.log`. Candidate gates and exact revision are recorded separately after integration. None of these proofs promotes the six global release deferrals or completes a P/A/H obligation.

## Original-runtime question responses

The optional authenticated Fetch response handler now accepts only an exact original question target, bounded JSON and idempotent answer identity. It borrows the original conversation/feature and human Context. The original native transaction remains the only resolution authority. Tests cover unauthorized/current-policy failures, forged targets/responders, native expiry, body cancellation, rollback on an observed in-transaction abort, and committed resolution recovery after a suppressed acknowledgement. This is in-process Fetch and actual native-storage evidence, not network/browser or identity-provider qualification. The package guide documents the missing atomic external revocation fence.

The pinned pi-codemode 1.0.0/quickjs-wasi 3.6.2 standalone probe passed real engine timeout and cancellation. It also demonstrated that `max_output_tokens: 1` is parsed metadata while ten output items are retained. There is no public production output cap and reserved globals cannot replace built-in output functions. Native transcript truncation does not bound prior host accumulation. The bounded probe is under `.cache/evidence/implementation/codemode-public-api/`. It is not native Durable integration or A14/A22 proof. This seam blocks only configurations promising that hard output guarantee; other roadmap work continues.

Strict question-consumer checking also requires the explicit `@modelcontextprotocol/sdk@1.32.0` development dependency because pinned upstream model declarations reference it as an optional peer. The initial isolated check failed on that missing declaration. The recipe installs the exact cached registry archive and transitive closure, then retains `skipLibCheck: false`. It does not claim the agent's declared peers alone suffice for strict checking.

## Native chat increment

The optional chat controller uses the actual native conversation/watch and exact submission lookup. It captures immutable input, retains uncertain admission, revalidates the original draft on retry, preserves later typing and reports native stop intent separately from confirmation. The React renderer drives those methods, retains assistant DOM identity across streaming/commit, bounds transcript mounting and keeps required cards visible outside history. Native entry overrides render once per entry. Tool results bind to their preceding call object even when another turn reuses its call ID.

Fourteen public controller scenarios and ten React DOM scenarios pass. Tests use native MemoryStorage, Harness, entries and a local public Models provider with no network/model spend. The isolated writing worker supplied test commits `fdf55d1`, `28f8cdd` and `8bea3db`; the coordinator reviewed their files and integrated the tested source and tests together. Independent review found retry validation, duplicate cards, tool-result association and off-window required decisions; all have explicit regressions.

The guarded chat consumer packs only UI, installs pinned registry dependencies, checks strict declarations and exercises actual native/React tests. The browser bundle must exclude native execution, files and Tiptap. The raw native view is trusted host data and expert presentation does not redact it. Chromium requalification failed before navigation with `sandbox_host_linux.cc:41 shutdown: Operation not permitted`; no permission changes were attempted. Native browser privacy, real scroll/focus/uploads, archived history, Markdown messages, grouped tools, shadcn and full A44/A45 remain pending. No global proof or complete P/A/H status changes.

Run `node examples/native-chat.mjs` after building for a real native conversation with a fictional local streaming model. It prints the admitted state, cleared exact draft and committed response. This headless demonstration makes no browser claim.

## Canvas document increment

The optional native tldraw controller publishes document snapshots through the existing exact receipt/CAS path. Markdown and canvas share a private text publication buffer. Native raw snapshot loads are observed through public store history and synchronized before late acknowledgement or delayed refresh can settle. A read-only controller cannot block another consumer of the borrowed store. Unsupported working records remain host-owned but cannot be published by this controller.

Eighteen public canvas scenarios exercise actual native stores and SQLite publication. The combined Markdown/canvas/React run passes 55 checks including parent suites. Review added raw-load race, shared-store ownership, second-mount draft protection and custom binding regressions. Tests establish DOM scheduling only. The SDK imports React DOM, so the test installs its scoped DOM before importing the SDK; the first combined attempt exposed cached non-DOM event support and remains in raw evidence. The SDK's supported test mode avoids its global user-sync BroadcastChannel. Default Node imports still retain that channel after store disposal.

The pinned dependency installation added 92 registry entries and preserved all existing registry versions. The first consumer assertion incorrectly excluded Tiptap, which is a direct public dependency of the selected SDK; the corrected recipe checks Boring entry isolation and excludes native execution/server files. No global proof is promoted. W10 remains partial, and P01-P14/A01-A48/H01-H10 remain in scope. Actual canvas rendering, agent shape tools, custom viewers, migrations/assets, browser/CSS/egress and license qualification remain work.

The strict canvas consumer currently fails because `@tldraw/utils` declarations reference `lodash.isequal`, `lodash.isequalwith`, `lodash.throttle` and `lodash.uniq` without their declaration packages. Neither npm cache contains those `@types` archives or transitive `@types/lodash`; registry lookup fails with EAI_AGAIN. The recipe retains `skipLibCheck: false`, runs independent runtime/bundle checks and exits nonzero for the declaration failure. Those missing dependencies block strict consumer qualification only. No ambient replacement declarations or upstream patches were added.

## Native canvas author compatibility correction

After the first canvas checkpoint, mounting an actual native `TldrawEditor` exposed a missing document record type. The pinned SDK inserts `user` records for attribution, so the initial allowlist rejected saving a mounted editor. The controller now preserves validated native author records while refusing nonempty author image URLs. Receipt identity remains bound to the authenticated resource client. The additional public regression persists a native author, verifies receipt identity, and refuses image URLs during capture and initial load. The earlier 61331b4 clean run remains historical evidence for its tested cases; it did not establish native editor interoperability.

The actual bare native editor now passes ordinary and React StrictMode mount/unmount/remount tests over a live controller and SQLite workspace provider. Native author creation dirties the saved document without publishing. After unmount, controller and external history listeners still receive raw snapshot loads and puts, and exact saves retain the native authors. All 59 combined Markdown/canvas/React checks pass. This proves that bounded DOM lifecycle, not rendered fonts/geometry, a Boring canvas toolbar, real browser behavior or production licensing.

## Native React canvas renderer

The optional canvas renderer lazy-loads the public full `Tldraw` component over the concrete publication controller. Its toolbar uses native tools, undo/redo and fit APIs. Save, lost-acknowledgement lookup and explicit conflict discard use the existing resource authority. Read-only state is applied before the host mount callback; unmount preserves the native session flag and leaves the borrowed controller alive. A prior host read-only flag remains set.

The pinned SDK's ArrowShapeUtil constructor does not satisfy its bare-editor public constructor type under exact optional properties. Using the full native component preserves its default registration without casts, patches or erased checks. Every font/icon/translation/embed asset URL must be supplied explicitly. Unsupported external-content and upload handlers are removed before the trusted host callback. One native editor per store is required.

Public tests mount actual Tldraw with SQLite and fictional font-loading/network boundaries. They exercise native tools/edits, exact saves, unknown acknowledgement recovery, conflict discard, read-only lifetime and late acknowledgement across document replacement. This is DOM evidence, not real font, geometry, pointer/browser or vendor traffic qualification. The installed renderer recipe selects the full SDK and native CSS, repeats public runtime checks and bundles browser output while retaining strict SDK declaration failures on missing lodash types and incompatible `ArrowShapeUtil` override declarations under exact optional properties. No complete W10/P/A/H or global proof is promoted.

The initial renderer consumer run installed 164 pinned packages and passed all 31 actual runtime checks and built both JavaScript and CSS. It exited 1 after these checks because the strict compiler reports four missing lodash declarations and two `ArrowShapeUtil` override errors. The full component fixes the wrapper constructor assignment problem, not the upstream declaration inconsistency. These failures are retained without `skipLibCheck`, casts or SDK patches. Raw output is `canvas-renderer-consumer.log`; the combined native canvas/Markdown DOM run passes 43 checks in `canvas-renderer-focused.log`.

Final ownership review removed automatic native Boolean restoration because it could clear a host restriction reasserted during mount. The wrapper now only tightens native read-only state; the host owns resetting it for a later session. Eight renderer scenarios (nine TAP checks including parent) and 44 combined canvas/Markdown checks pass. Worker commits `05ee65f` and `008fe61` supplied the bounded test file, reviewed and integrated by the coordinator. Raw output is `canvas-editor-controls-host-policy.log` and `canvas-renderer-focused-host-policy.log`.

## Markdown heading navigation and local selection

The rich editor derives its outline from the native Tiptap document. Clicking a heading selects/focuses its native position without writing the controller or provider. Stale actions check the controller, buffer version and exact native document identity. Rich/source mode switches retain local selections only for the same buffer version, including backward direction through native `SelectionBookmark` and textarea range APIs. Changed content or controller replacement invalidates old bookmarks. The controller and its exact publication contracts are unchanged.

Six DOM scenarios use real Tiptap, DOM selections and SQLite. They cover H1/H2/duplicate targets, backward source/rich ranges, changed-source invalidation, controller replacement and a whitespace-only source edit. That last case failed against the earlier compiled output because deep equality retained an obsolete document identity; the outline now compares native document references. The negative result is an actual heading-selection assertion failure, not a compiler or fixture error. Both outputs remain in `markdown-navigation-whitespace-negative.log` and `markdown-navigation-whitespace-positive.log`.

The packed editor recipe repeats these public tests and strict declarations without native Pi or canvas peers. These tests establish local DOM behavior; browser caret/scroll/input/IME/accessibility and mounted agent command bindings remain unqualified. No P/A/H completion or global proof is promoted.

## Virtual hard-link correction

The pinned upstream filesystem creates hard-link aliases that separate after a write. Direct hard links now fail with ENOTSUP. Stock Bash `ln -f` removes an existing destination before calling the filesystem, so the virtual workspace also rejects hard-link arguments at the command boundary. Symbolic-link arguments delegate through public `context.origCommand` and retain upstream command semantics and invocation limits. Host custom commands and omitted builtin commands retain their selected behavior. Raw host-created Bash instances remain host responsibility.

Six public regressions cover direct refusal, forced/combined/long flags, literal `--` operands, nested Bash, native execution, symbolic writes, literal metacharacters and host command selection. The existing 14 execution tests also pass. Worker commit `8551af6a76024af29c726301cb7d91d70ba25dca` supplied the filesystem change and tests. Independent review replaced a fresh Bash delegation with the public original-command seam. Original alias-divergence and destructive forced-link evidence remains under `.cache/evidence/`; no atomic path or complete filesystem guarantee is promoted.

## Shared local Git service

`@hachej/boring-files/git` now owns one host-created repository over the public isomorphic-git filesystem contract. Direct callers, installed Bash commands and the ordinary native `working_git` tool share that instance. A queue serializes service operations. Whole-repository authorization is checked after waiting and before returning results. Status/worktree walks disable index refresh. Errors distinguish refusal before mutation from possible prior Git effects; the native tool remains unsafe to replay.

The local subset supports init, status matrix, add, index-only removal, commits, history, branches, checkout and exact tree/index/worktree blob diffs. Indexed content comes from the native object database because the upstream stage walker supplies object identity without content. Diff excludes repository metadata, rejects non-blob entries and reports output-limit failure without fabricated empty bytes or truncated success. Traversal is serial; upstream blob allocation and raw filesystem concurrency remain separate limits.

Ten public disk-repository tests cover binary content, branch checkout, index-only removal, unchanged index bytes after reads, strict/queued authorization, concurrent staging, late cancellation after a real index write, withheld read results and actual submodule-entry refusal. One native Harness journey shares commits/history/diff and denials with Bash. Installation checks the public `bash.fs` identity because upstream supplies a different filesystem facade to command callbacks. The old per-command repository API and all internal callers are migrated together.

The guarded virtual recipe first installs only files/execution Boring packages and executes their public tests with strict declarations, then installs the optional agent and repeats the native Git journey. Its registry closure explicitly includes the existing pinned MCP SDK required by upstream declarations. No ambient types or weakened checking were added. The complete exposure still requires lower filesystem policy; this service does not constrain raw `.git` writers or separate repository objects, provide remote transport, durable recovery, publication receipts or revocation rollback. W06 and all P/A/H qualification remain partial.

## Borrowed remote Shell transport

The paired Fetch adapters preserve native `Shell`, `ShellExecOptions`, `ExecutionError` and existing borrowed lease identity. The handler authenticates/selects one host workspace and checks its exact provider/instance/incarnation/view before native execution. Current command authorization runs before execution and terminal disclosure; a host revocation signal interrupts silent streams. The client validates identity before output and accepts one ordered terminal result only after EOF. Interrupted or malformed acknowledgements remain unknown and never trigger automatic replay.

Sixteen public scenarios execute real NodeExecutionEnv commands, native timeout and spill files, live combined output and a native Harness ToolTask without a dummy filesystem. They also cover independent cwd/input capture, strict authorization, option refusal, real mutation followed by response loss, malformed frames, pending Fetch/read abort, local callback failure, output limits, buffered-frame cancellation, and independent lease cleanup. Independent review caught unnecessary output forwarding on exit-only calls. The negative control restores that defect only in isolated compiled output and fails the real large-output regression; restoring the implementation passes it.

The isolated consumer installs only execution and its pinned native registry closure. It checks public declarations without skipping library checks and repeats these native scenarios without Boring files/UI/agent or just-bash/Git peers. The demo uses fictional Request/Response loopback and an actual native command. No socket, browser or vendor service is involved. Localhost listen fails with EPERM in this environment. Transport queue/frame limits do not bound provider output production or Fetch allocation; cancellation does not prove process-tree termination. Durable command admission/recovery, file access, provisioning/reattachment and protected remote builds remain open. W07 is partial and no full P/A/H or global proof is promoted.

## Assistant Markdown rendering

The optional chat renderer now uses a private Marked lexer and React elements for common Markdown and GFM. It preserves native text-part boundaries, assistant row identity and the existing newline-joined Copy response source. Public `entities@8.1.0` decodes prose, titles and link destinations once; code, escaped tokens and raw HTML stay literal. Generated Markdown images produce descriptive text without resource elements. Only validated absolute HTTP(S) links become clickable anchors, with no automatic navigation and no claim that this replaces host egress policy.

Six new scenarios, seven TAP checks including the parent, drive the public ChatPanel through a real native Harness and fake model. They cover GFM structure, code/HTML/entity fidelity, unsafe URLs, absent generated resource elements, source copying, partial fenced streams retaining DOM identity and global Marked isolation. Existing ChatPanel and native controller suites also pass. Independent token-boundary and comment reviews found no remaining concrete defect. No renderer source was copied from legacy. Syntax highlighting, mention routing, link-copy affordances, grouped tools, archived history, styling and actual browser behavior remain separate work. W05 and all P/A/H obligations remain partial.

The expanded isolated chat consumer installs the exact Marked/entities peers, passes strict declarations and all 32 native/DOM checks, then builds a 197.2 KiB browser bundle without kernel, files, editor or canvas implementation. Public imports still require no Tiptap or canvas peers. Raw logs distinguish that result from browser qualification.

## Installed Markdown source recipe

The first shadcn item uses the pinned 4.21.1 CLI and a copied React wrapper over the existing public Markdown editor. The item preserves concrete controller props and uses scoped CSS with host tokens. Its exact direct dependency pins match the public UI peers. `registry/README.md` owns installation instructions and qualification limits.

The controlled local fixture uses original cached registry archives and a freshly packed UI archive. It checks registry integrity, embedded name/version and installed version before exercising the copied component. This is a local artifact installation qualification; hosted registry and npm metadata resolution remain open. The committed item retains its version pins. Empty fixture baseColor leaves theme ownership with the host and avoids the CLI's optional color-preset fetch.

`test:registry-consumer` drives source/rich mode, exact save and lookup, bound proposal commands with human acceptance, stale-write protection, explicit discard, read-only controls, borrowed teardown and scoped host styling. It repeats after editing the installed class and style, then checks strict declarations and the browser bundle. Happy DOM is not browser qualification. Additional registry recipes, full A20/A46, custom viewers and W10 completion remain required.


## Installed native chat source recipe

The chat item imports the existing public ChatPanel and preserves its concrete native controller and callbacks. Its pinned peers include native Pi/Chord/AI and the MCP package needed by upstream public declarations. The local installer uses the same real CLI and verified archive fixture as Markdown. Generated native handles, host tools and authentication remain host responsibilities.

The installed fixture drives a real Harness and fictional streaming provider, unknown-admission reconciliation without duplicate submission, host decisions, an actual native ToolTask result and unmount during native generation. A repeated restyle run asserts copied classes and computed styles, including dark host backgrounds for code and required actions. Strict declarations and browser bundle isolation remain enabled. The shared fixture also reruns Markdown to protect its existing installation path.

A consumer nested beneath this repository exposed upstream OpenAI declaration probes of ancestor undici files, plus a parent buffer polyfill. The physical declaration guard refused them. The chat recipe runs under /tmp with no repository ancestor; no upstream declaration or isolation rule is patched. Canvas/custom viewer/agent recipes, browser journeys and full A20/A46 remain pending.

Review found that the first Markdown item omitted its selected `@hachej/boring-files` dependency while the fixture preinstalled that archive. The item now declares the exact peer, and the fixture derives all packed Boring dependencies from the item itself. Earlier local installation evidence included this extra setup; it did not prove the original item dependency list was sufficient.

## Authenticated resource read, publication and lookup

The optional files remote entry pairs Fetch functions over the existing independently injected resource capabilities. It captures caller bytes, validates bounded versioned messages and compares atomic receipts with the original operation, digest, actor and complete target transitions. The provider remains the only commit authority. Lost replies, HTTP authorization failures, malformed results and observation cancellation retain unknown publication outcomes without automatic replay. Read failures cannot become invented missing resources, and failed lookup cannot become provider not-found.

The native ToolTask and headless Markdown controller now compose through this same authenticated boundary. Public cases drive actual SQLite binary/history/batch behavior, stale writes, duplicate IDs, actor/view/path isolation, postcommit revocation, lost acknowledgements, input mutation, receipt corruption and stream cancellation. The installed document consumer adds strict remote declarations and a browser bundle with no native/runtime/filesystem implementation. The new example uses fictional in-process Fetch objects. Existing SIGKILL fixtures retain their separate crash evidence; response loss is not a crash test.

Independent review removed an invented receipt-order constraint and replaced per-chunk retention with a bounded growing buffer. Existing owners do not establish one per-change receipt digest/operation convention. This adapter refuses per-change publication before dispatch and treats partial acknowledgements as unknown. That qualification remains required under A16. Lookup cannot validate unknown original arguments from an operation ID alone; caller reconciliation retains that responsibility.

W04 remains partial. Working remote FileSystem/provider acquisition, deployment/browser policy, atomic revocation fencing and durable remote command admission remain open. Serialized message limits do not bound trusted local input capture, JSON expansion, Fetch allocation or provider production. No full P/A/H obligation or global verification deferral is promoted.

## HTML source, passive preview and installed recipe

The concrete HTML controller reuses exact resource buffer publication, dirty protection and lost-ack reconciliation with strict text/html and UTF-8 loading. It does not register Markdown native tools or a second state authority. The optional React renderer switches between exact source and reconstructed passive formatting. Its detached template nodes are never connected or adopted. Fixed CSP, empty iframe sandbox and no-referrer policy precede attachment. Trusted Types or limit refusal leaves source/save controls available.

Ten headless cases and sixteen DOM scenarios plus their parent exercise exact/new saves, stale identity, dirty buffers, late/lost replies, readonly state, teardown, attribute/active-content removal, size refusal and source recovery. Review found a leading-newline loss in preformatted text after the second parse; serialization now emits a protective newline. Happy DOM's template owner and custom-element behavior differ from browsers, so those tests establish structure and controls only. Chromium failed at startup with sandbox EPERM before any browser assertion ran.

The isolated HTML consumer retains strict declarations and excludes native/server/editor/canvas runtime from its composed browser bundle. The shadcn item copies a thin concrete wrapper and scoped styles. Its local installation uses verified cached archives and the real CLI. The installed wrapper repeats the public DOM behavior and host styling checks before and after editing copied source. Native browser security, hosted registry resolution and full A20/A46 remain open. No global proof or complete P/A/H obligation is promoted.

## Fixed and derived reference experiences

The optional validation and React entries use exact json-render 0.21.0 and Zod 4.6.5 peers. Descriptors carry bounded layout props and registered cell references. Host renderer components retain their concrete controllers and operations. Validation checks installed versions, per-kind props, current visibility, tree shape and use limits, then freezes a detached result. Render checks access again through current host context. Descriptor replacement is offered for explicit acceptance; invalid proposals preserve the current layout, and initially denied descriptors can recover when host access becomes available.

Independent review reproduced native signature caching failures for Object.prototype element IDs and identified an unavailable-initial-state dead end. Boundary ID rejection and explicit revalidation of unavailable layouts address those defects without patching upstream. Public validation and real React/json-render/SQLite tests cover these controls. The installed recipe checks strict declarations and validation without files, browser/validation dependency isolation, then explicit files installation for borrowed document cell tests. Actual browser focus/layout and full experience acceptance remain unqualified.

The first descriptor grammar refuses actions/state/binding/watch/repeat/visibility/slot/generated fields. Native providers include built-in state actions even with no supplied handlers. Durable actions remain host cell behavior with current authorization; no descriptor action dispatcher is advertised. Generated regions, region pinning, richer catalogs, mixed-app recipes and full A27-A32 remain required. No full P/A/H or global proof is promoted.


## Conditional layout Keep

The optional experience document controller uses the existing exact resource buffer for fixed JSON layouts. Offers retain their exact base and remain separate from the selected draft. Explicit adoption changes only the local draft. Keep creates or conditionally replaces the resource with a real receipt. Dirty conflicts, late acknowledgements and unknown reconciliation preserve later local work. React controls borrow the layout and embedded controllers; replacing a controller resets the rendered layout even at equal buffer versions.

Independent review found reentrant callback defects in adoption selection and save preflight. Adoption now derives its returned version from the fenced proposal base. Keep validates the core buffer snapshot and preserves an intervening publication's unknown result. Refresh rechecks the core after host decoding before replacing text, and explicitly retries unavailable layouts when access returns. Public regressions exercise these cases with real SQLite publication.

The isolated experience consumer first retains files-free validation/rendering checks, then explicitly installs files for concrete Keep declarations, native React/json-render controls, real receipts and the composed browser bundle. The fictional `examples/experience-keep.mjs` demonstrates offer, local adoption and conditional creation separately. No live model is involved. Browser interaction and commit-time cross-resource visibility require separate qualification. W11, full A28-A29, generated regions/pinning and all P/A/H obligations remain partial.


## Native metadata composition

`composeExperience` uses the pinned upstream composer and evaluator types. It captures static host configuration and enumerated candidate metadata before its first yield, uses opaque identities, and rebuilds every generated descriptor without state before current-access validation. Partial output stays separate from the selected document. Final output uses existing exact proposal/adoption/Keep controls. Provider admission, processing policy and budget remain host responsibilities.

Public tests use real native composition, deterministic evaluator choices, upstream Gateway evaluation through fictional fetch, real React/json-render and SQLite. They exercise sentinel stripping, bounded metadata, invalid choices, captured inputs, live revocation, noncooperative cancellation, stale composition results, borrowed dirty controllers and actual fixed receipts. Independent review found a between-step revocation gap. The adapter now rechecks visibility before every evaluator delegation. A two-cell regression reaches the native second evaluation; removing the compiled guard produces two evaluator requests instead of one, and restoring it passes. One-cell composition skips the second evaluation and would have been an insufficient regression.

The updated isolated tarball consumer preserves strict declarations, physical dependency guards and files-free composition. No live provider request or native replacement engine was added. Bounds are accepted-input/evaluation limits, not provider allocation guarantees. Generated regions/pinning, live local/Jev quality, browser focus and complete A27/A29/A31 remain separate required work. No complete P/A/H obligation or global proof is promoted.


## Generated regions and conditional Pin

Region composition now narrows native candidates by each enclosing allowlist, declared kinds, remaining global cell uses and element/depth capacity. Explicit triggers and registered static guidance precede evaluator calls. Merged snapshots preserve fixed descriptor nodes. New request identities fence old offers without changing the document until adoption.

The existing document controller preserves raw fixed JSON when adopting a region and uses its existing writer/lookup for Pin. Pin is eligible only for a clean-origin draft limited to the same region. Unrelated dirty edits require whole-layout Keep. Fixed sibling DOM and borrowed controllers stay mounted. Grid tracks and cells inherit region minimum widths.

Public native composition, SQLite and React DOM tests cover exact source spelling, stale requests, conditional receipts, lost replies, late drafts, readonly behavior, metadata capture, bounds and fixed editor identity/selection. Independent review found and corrected callback input-capture issues, depth accounting, denied/stale request retention and grid tracks that could shrink below cell minima. The source test caught trailing whitespace moving before appended nodes; that whitespace now remains with the original closing suffix. Existing reentrant and accessible-label regressions remain exercised.

The isolated experience consumer includes region exports, concrete request/Pin types, all public region suites and browser dependency checks. The fictional `examples/generated-region.mjs` demonstrates the explicit composition-to-Pin path. These are development/DOM qualifications. Actual browser geometry/focus, live model judgment, deployment admission, atomic cross-resource authorization, richer application actions and full reference recipes remain pending. No complete P/A/H obligation or global proof is promoted.

## Native remote working files

The optional execution adapter now exposes all native `FileSystem` methods through authenticated Fetch. It preserves native cwd/path semantics and returns native errors. Per-request binding validates the actual workspace identity, filesystem namespace and cwd. Working-file writes retain possible prior effects after lost acknowledgements and never replay automatically. Published resources keep their existing conditional writer/lookup authority.

A single stream retains each native text reader. Read-wait cancellation preserves the pending frame. Opening-context cancellation detaches after successful opening. Revocation, EOF and explicit close share cleanup that closes the native reader before releasing its facade, including synchronous callback reentrancy. Authorization runs before and after reads, with actual binding validation after each asynchronous policy callback.

Public tests exercise real Node files, binary and native path methods, a native ToolTask, same-namespace Shell agreement, stale identity/cwd, denied calls, lost append acknowledgement and independent leases. Reader tests cover LF/CRLF, empty and unterminated lines, cancellation, malformed/oversized frames, backpressure, delayed binding cleanup and concurrent teardown. Independent review identified unbounded waits for transport cancellation, stale failed-open disclosure, callback ordering and cleanup reentrancy. Focused regressions cover those defects. These are transport/race tests, not additional hard-crash evidence.

The isolated consumer keeps strict declarations and physical dependency guards. Its first run caught undici's bare buffer declaration resolving from a parent workspace. The fixture now installs the already pinned buffer package locally. The fictional remote-files demo performs a native write and streamed read without exposing exec. Provider provisioning, lost acquisition replies, expiry/reattachment, durable command admission, protected builds, socket deployment and complete path/exposure policy remain unfinished. No full W/P/A/H obligation or global proof is promoted.

## Native archived chat history

The concrete chat controller now pages native fork-aware history while retaining its active watch unchanged. One native page of at most 40 entries is retained. The fixed inclusive upper bound and opaque cursor survive concurrent new writes and read failures. Head changes, non-append updates, clear, reconnect and disposal fence late responses. Explicit history capability is required with a custom source. Native parent-owned fork records remain valid.

The renderer separates read-only history from active rows and current custom cards. Per-page controls expose large multi-message entries within the 200-row mounted limit. Active rows retain their task identities. Review identified stalled earlier-message navigation under the reduced active window and a missing post-read capability-identity check; both have regression tests. Native tests use real Harness resets, heads and forks. DOM tests and copied-source installation exercise controls and preserve current drafts/tasks. No actual browser scroll/selection or complete A44 claim is made.

Strict installation initially caught native SDK declarations resolving optional buffer/undici types from parent workspace directories. The fixtures now install the already pinned optional type packages locally and place their disposable installation beyond that SDK's fixed ancestor probes. Physical dependency guards and strict declarations remain enabled; no SDK source or compiler checks were weakened. The packed chat consumer and actual shadcn installation/restyle both pass. Chromium qualification still fails before navigation with sandbox EPERM.

## Current-hub reference-only companion

The fictional current-hub composition now runs three native Harness instances. Two apps own their private inputs, native producer/delivery pairs and SQLite publications. The companion's statically bound native tools pass permitted references and captured host identity. App request documents atomically bind canonical input references and actor/installation to native task IDs. Duplicate requests recover the same binding; changed bodies conflict. A persisted native storage incarnation prevents coincident numeric IDs in another store from matching.

The companion reconstructs allowed response fields and rejects misbound references. App exceptions and unsolicited content never become tool output. Native safe replay checks its retained invocation memo; changed or missing identity returns unknown without dispatch. Post-admission authorization changes also retain uncertainty. Observations compare the exact durable reference and reauthorize after awaited native reads. Native task completion and publication outcome remain separate.

Sixteen focused cases use actual native tools, a fictional provider conversation, SQLite and five real child-process SIGKILL boundaries. They prove both apps retain their own planted private input/result markers while the hub's current records, captured prompts and SQLite/WAL literal scans remain clear. A leaking native tool-result negative control is detected. The scans do not prove every external telemetry/cache sink or arbitrary encoded content. The app admission crashes preserve producer, delivery, operation, receipt and revision; hub tool crashes with changed/missing identity or revoked app policy do not invoke another app. Detaching the companion leaves app-owned work running.

Review corrected a native draft-proxy copy on duplicate admission and false denied outcomes after dispatch or interrupted replay. Each has executed regressions. The worker's initial retry failure was recorded in tool output only; coordinator raw passing runs and demo failures/corrections are retained under `.cache/evidence/implementation/`. No package dependency, native API, global invariant proof or consumer source changed. Run `node examples/current-hub.mjs`; the [fixture guide](../../examples/current-hub/README.md) states exact ownership and limits. W12 is now partial. File-app definitions, fixed cross-app UI actions, change-request handoff, full H10/A48 and redaction remain required.


## Pinned definition increment

The optional `@hachej/boring-agent/definitions` loader reads authorized exact resource revisions as data and returns a native `AgentChange` with source digest, scope and compatibility versions. Its 11 public tests include real SQLite revision selection, malformed/denied data, mutation across awaits, current resolver revocation, actual native publication, native binding persistence across reopen and the existing same-name replacement behavior. The isolated files/agent archive recipe repeats these tests with strict declarations and no UI/execution installation. Import-only execution checks that the adapter does not load the native implementation.

The loader does not apply configuration, execute tools, install code, own resources or grant admission. Native configure keeps names and can resolve later replacements/wrappers. Host version tokens must cover the effective implementation; admission/recovery must recheck reproducibility and authorization. No provider allocation or arbitrary callback cancellation guarantee is claimed. Full file-app/hub composition, cross-app actions, handoff, redaction, browser and all remaining P01-P14/A01-A48/H01-H10 obligations remain open. Six global release deferrals remain unchanged.

The user explicitly requested regular GitHub pushes. A fresh connector write attempt after that request was rejected because approval is required under policy `never`; local `gh` credentials also failed validation. No remote branch or PR was created. Continue local tested commits and verified bundles until permitted GitHub write access exists.

The user subsequently authorized committing and pushing directly to `main`, superseding the earlier branch-only target. Remote writes are still unavailable under the same session policy. No push or main update occurred.


## Exact Unicode text correction

Ten failing-before public regressions exposed default UTF-8 decoder behavior: opening Markdown/HTML or applying a native patch dropped leading U+FEFF, while saves, delivery and exact text edits rejected it as invalid Unicode. Text resource reads and validation now preserve that scalar with `ignoreBOM: true`; JSON and wire grammar decoders retain their existing behavior. The focused suite also retains invalid-surrogate refusal and exact revision/receipt assertions. Raw before/after evidence is under `unicode-*.log`.

A subsequent external review identified additional issues under investigation: local remote-client preparation errors can lock an editor in unknown state without dispatch; SQLite reads/lookups reserve the writer lock; conversation projections resend their full visible transcript; the virtual shell refuses stock native Bash output callbacks. The first two were reproduced locally. Full projection and native Bash qualification remain open. Requested Claude Code Fable review failed with EAI_AGAIN before API token usage; it supplies no independent model-review evidence.


## Review-driven save and SQLite corrections

The external review's stuck-editor and SQLite read-lock findings were reproduced before correction. A locally oversized publication performed zero fetch calls yet trapped the editor in `unknown`, and reads/lookups waited about five seconds for an unrelated writer reservation. Local preparation now throws explicit `PublicationNotDispatchedError`; the controller clears only its matching fresh attempt and retains later edits. Generic transport failures, HTTP rejection, post-commit errors and missing receipts remain uncertain. An additional regression exposed an extracted publisher losing its receiver; the captured callback now binds to its client. SQLite readers use deferred transactions while publication still owns its write transaction.

The existing pre-aborted and unsupported-atomicity test expectations change to the typed preflight rejection. Server body-size rejection and lost-acknowledgement assertions remain unchanged. A callback throwing that class after a real commit still returns unknown and recovers the original receipt. The expanded document tarball consumer checks strict public declarations, browser isolation and these public provider/controller tests without Pi or React installed.

Full-transcript projection and the stock native Bash callback gap remain open, along with the other full roadmap obligations. The requested full external review, including its two unspecified highest-severity findings, has not yet been supplied. No claim that this addresses that unseen review is made.

## Bounded conversation projection

The measured version 1 transport sent 2,078,113 bytes for 10,000 retained fictional messages and repeated that payload after each configuration-only change. Version 2 bounds the initial window, suppresses unchanged visible output and sends changed rows with their complete bounded order. The handler sends a delta when its encoded frame is smaller than the snapshot, otherwise it sends the snapshot. The pure receiver validates identity, sequencing and budgets before atomically replacing its bounded cache; gaps clear the cache and require a fresh authorized initial snapshot.

The public native tests cover 10,000 entries, many messages in one entry, encoded-byte limits, escaping, Unicode clipping, policy removals, native reset/fork, backpressure and revocation. Receiver tests exercise malformed and out-of-order frames, detached return values and reconnection. These are retained-text and in-process Fetch qualifications. Native live generation, browser presentation, network framing and socket/authentication deployment remain open. No full P/A/H obligation or global release proof is promoted.

## Current-hub definition execution increment

The fictional apps now load explicitly provisioned exact `agent.json` revisions through the public definition loader. First admission configures the native conversation and retains its definition binding in the same transaction as the request and producer/delivery pair. The producer creates a real native report ToolTask. Tool execution revalidates the original definition, host/tool implementation versions, current permission, configured instructions and producer ownership before returning private text to document delivery. Later revisions cannot redirect existing work; changed native configuration refuses without being restored silently.

Definition-read, execution and publication policy are separate. Independent review found that revocation during asynchronous admission could still commit configuration and tasks. A queued-revocation regression reproduced `admitted`; the final transaction check now throws to roll back and returns `unavailable`, reserving `unknown` for uncertain outcomes. Malformed/executable definitions, missing tools, revoked reads, changed host/tool identity, forged child ownership and native configuration drift have executed tests. A large multiline definition checks exact output beyond default native truncation. The public loader also preserves its resolver callback receiver; its regression failed before the fix.

The two new actual SIGKILL cases stop a report ToolTask at durable execute intent. Reopen either completes the original child using the original definition or refuses revoked definition access without publication. The latter deliberately resumes through privileged inspection access to test the execute-body authorization guard. Five existing admission/companion crash cases now also replace the latest definition before recovery and check the original binding. Literal privacy scans include definition markers alongside input/result markers. The isolated files/agent tarball consumer repeats the fixture and loader/native cases with strict declarations; no UI/execution package is installed.

Fixture instance storage is version 2 and explicitly refuses version 1 because old admitted work lacks a qualified definition binding. The companion reference protocol remains version 1. No consumer migration, model call, registry service or global invariant proof is claimed. See the [fixture guide](../../examples/current-hub/README.md) for execution commands. Fixed multi-app actions, change-request handoff, browser/wire and consumer-owned compatibility, historical H01-H09 and redaction remain required. W12, H10/A48 and the full roadmap remain partial.

## Fixed current-hub cells increment

The fictional hub now has a fixed two-app Experience. Host-owned status cells route invocation and observation to their captured app instance. They copy only validated scalar references into disposable display state. Native invocation and document delivery remain authoritative. Known native states remain distinct, failed observations are unavailable and lost invocation acknowledgements remain unknown. Same-request retry recovers the original graph.

Driven React/json-render tests in HappyDOM use two real SQLite/native apps. Initial denial affects only its own cell. Tests drive independent actions, verify exact references and publication, retry after an actual admitted call throws, invalidate pending replies across visibility and actor changes, and complete a gated producer after the view unmounts. StrictMode and remount dispatch nothing. Negative responses cannot replace task identity or inject private fields. The host must rerender on idle authority changes; no authentication subscription or remote service is implied.

Review found that a callback could mutate the same reference used for observation validation. Its regression displayed a substituted task as committed before the fix. Observation now receives a copy and compares its reply against a separate captured reference. Review also corrected stale render-time identity checks, initially unavailable status text, omitted native states, admission/child-count test races and a bundle check that externalized the dependency graph. The final source bundle and installed experience archive include the actual UI dependency graph and exclude native/server modules. No real browser journey, change-request handoff, consumer compatibility or global proof is promoted. H10/A48 and all P01-P14/A01-A48 obligations remain partial.

## Source-owned fictional change handoff increment

The current-hub demo now stages user-authored fictional request text directly at its owning app and invokes a native change tool with references only. A separately owned SQLite workspace (one per scope) atomically creates an issue and receipt from deterministic source/context/actor bytes. Duplicate requests retain the original issue; changed source/context conflicts, and changing the latest draft does not replace the exact staged revision. The optional tool uses native memo for its original binding and revalidates inside execution. Companion setup refuses a change path bound to another incarnation of the report app.

Issue content and current state remain at the source owner. The hub returns selected issue/receipt references. `readIssue` checks the original creation receipt and immutable body before returning current owner status; privileged fixture updates use real conditional publication. Native/SQLite tests cover scope/cross-app denial, immutable tampering, stale status writes, literal private-marker residency, source mutation across awaits and borrowed lifetime. Three actual SIGKILL cases stop after issue commit before native acknowledgement, then recover the same issue or preserve uncertainty under revoked access/changed actor.

Review found actor/request capture occurring after asynchronous memo lookup and missing report/change installation matching. Both have actual failing-before regressions and pass after correction. The held-memo case is a callback-boundary test; the separate child-process cases establish native crash behavior. A pre-publication context-read failure also reproduced a false unknown; it now reports unavailable with no receipt. A valid storage receipt with malformed original issue content was incorrectly observed as open; the reader now validates the canonical domain binding before accepting status changes. Uncertain publication and retained replay stay unknown.

The isolated files/agent consumer now copies and exercises the handoff fixtures and all ten current-hub SIGKILL cases. This is a fictional local issue provider, not an external repository issue integration. Cross-app reference sharing, real identity/revocation, browser/wire, external GitHub idempotency and consumer-owned compatibility remain unqualified. No consumer, external issue, build/merge/deployment or global proof changed. Next is the redaction fixture and remaining full roadmap; W12/H10/A48 remain partial.

## Conditional delivery guards and native migration

Delivery now accepts optional ResourceExpectation preconditions alongside its existing output target. Admission validates and copies the guards before asynchronous producer creation. Native task version 2 retains them, and the publication digest binds the same conditions that SQLite checks with the output mutation. Changed generation or human-edit revisions refuse stale output. Separate subject guards allow an unaffected sibling to publish.

The public-output tests exercise actual native tasks and SQLite writes, including immutable capture and malformed or sparse guards refusing before producer creation. Seven additional child-process SIGKILL cases cover guarded publication before/after commit, v1 wait/validate/publish migration, malformed v1 refusal and v2 downgrade refusal. The v1 cases use public native witness definitions with the original input/checkpoint/memo shapes; they do not install an older library archive. Lost acknowledgement reconciles the original receipt after a guard advances, without publishing again. Migration preserves the original unguarded contract, including namespace/validator values accepted by v1.

The installed files/agent consumer checks both old and guarded admission signatures with strict declarations and repeats the new public-output/crash cases. Final command results and exact candidate stay under `.cache/evidence/implementation/`. This increment supports W03/W12 and fictional redaction prerequisites. Provider guard advancement plus native admission recovery, stable item corrections, typed tool evidence and bounded repair remain unfinished. No full P/A/H obligation or global release proof is promoted.

## Fictional redaction reservation and recovery

The source-owned fixture now commits an immutable request reservation and per-subject generation guard together through the real SQLite publication batch. The shared reservation path fences changed principals/initiators before they can advance a guard, despite actor-scoped operation receipts. Canonical original source/config/output/edit expectations and an opaque generation UUID survive retries. One native transaction then records the request and creates producer/delivery tasks. These provider/native transactions are a recoverable boundary, not one atomic commit.

A/B/C complete independently. Human edits block stale output without being overwritten. Twelve functional cases cover duplicates, different-actor and same-actor concurrency, caller mutation, source/config rebinding, admission revocation and protected reference disclosure. Five actual child-process SIGKILL cases prove recovery after reservation, native admission and output commits, including superseded and revoked recovery. Read revocation after a provider commit returns a reference-free reserved outcome rather than a pre-effect refusal; native commit uncertainty retains the original request for reconciliation.

Delivery access resolution now accepts async callbacks plus explicit admission access. Real tests found that querying tx.task after producer creation throws native ReadAfterWrite; the host instead captures authenticated identity before creation, and publication resolves the original actor from committed native state. A separate delivery SIGKILL regression mutates the resolver's retained credentials during lookup and proves publication uses the detached original credentials. Rejected async admission resolution rolls back both native tasks.

Run `node examples/redaction.mjs` after building for three actual native deliveries with fictional text and no model/browser. The installed files/agent consumer repeats fixture and public/crash cases with strict declarations. Raw review, focused results and final candidate gates are under `.cache/evidence/implementation/`. Stable per-item corrections/adoption, actual tool evidence and bounded native repair, structured record-plus-letter delivery, browser/flush journeys and expert/live-model acceptance remain unfinished. W03/W12 remain partial; no complete P/A/H or global release guarantee is promoted.

## Native structured validation and bounded repair increment

`@hachej/boring-agent/validation` now provides an optional native validation task and shared check over actual retained ToolTask results. Twelve public tests cover ownership through child conversations, sibling/fork rejection, missing/error/diagnostic evidence, current authorization, strict JSON and mutable callback boundaries. The host's validator interprets actual return values. Native call arguments are the original model arguments, not a guarantee of arguments changed by native preparation/hooks.

The [fictional validated-output fixture](../../examples/validated-output/README.md) executes ordinary native generation and two real tools through a local scripted Models provider. It records bounded repair decisions under the original generation and answer digest, retains evidence for the exact settled answer and gates formatting/publication with a separate native validation task. Eleven composition tests cover successful repair, exhausted allowance, missing/forged/genuine foreign evidence, denied tools, hook failure, publication revocation and later evidence overwrite. Two actual SIGKILL tests recover the original native request and repair decision; reopening with a larger allowance and changed scenario cannot replace the admitted input or permit unsupported output. The isolated files/agent consumer repeats these tests from installed archives with strict declarations.

Run `npm run build` then `node examples/validated-output.mjs`. This is partial W03/W12 and direct-tool evidence for R01. Full redaction integration, stable item corrections/adoption, structured record-plus-letter publication, nested code-mode evidence, actual provider-attempt budgets, live models/sources, browser/human judgment and all six global release proofs remain unqualified. No P01–P14, A01–A48 or H01–H10 obligation is promoted to complete.

## Fictional record and letter adoption increment

The redaction fixture now implements typed native proposals, stable host item IDs, independent corrections and explicit conditional adoption. The effective record and letter publish in one real SQLite transaction. Original native request/task bindings, immutable correction request resources and durable attempted intent preserve duplicate and recovery semantics. Provider reconciliation remains authoritative for current receipt disclosure. See [the feature map](FEATURES.md#fictional-redaction-corrections-and-adoption) for tests and limits.

Run `npm run build && node examples/redaction-adoption.mjs` for a fictional proposal, human correction and mixed adoption. Final clean command logs, exact commits, independent review findings, installed-consumer evidence and the recovery bundle remain under `.cache/evidence/implementation/`. The previous full checkpoint was `23dace8ed6562e9d3939ad1e30d9854c43e5d0ab`; current evidence records the new candidate exactly.

W12 remains partial. W00 stays reconciled, W01-W08/W10-W13 remain partial and W09 remains a public-seam probe. P01-P14, A01-A48 and H01-H10 remain in scope without a full qualification claim. Six BORING-PI release deferrals remain. Browser/live/clinical and external consumer delivery are still separate gates. GitHub pushes remain blocked by the recorded automatic approval rejection and invalid CLI credentials; implementation commits and a verified bundle are retained locally.

## Native chat grouping increment

The optional `ChatPanel.groupTool` callback adapts the pinned timeline grouping behavior using host declarations and direct native call/result types. Adjacent successful completed calls can share a collapsed group in developer mode. Required cards, failures, pending calls, text and reasoning break groups. Streaming details preserve their DOM node when the native message commits, and archived history never invokes the classifier.

Public native/DOM tests, strict isolated chat archives and the actual installed shadcn recipe cover this increment. The installed recipe also repeats the tests after copied-source restyling. These checks do not establish browser scroll/focus/selection or full A44. W05 and the overall roadmap remain partial; release deferrals are unchanged.

## Native adoption cancellation increment

Three regressions use the actual native Harness abort API and held publication boundaries. Before the fix, cancellation inside the publisher still created both outputs. Passing `runtime.signal` to the existing publication access checks prevents that write. Cancellation after commit preserves the original receipt and revisions. Recorded intent, acknowledgement and terminal native state are asserted separately.

The focused adoption and crash suites pass 28 tests. Raw failing-before and passing-after evidence is retained under `.cache/evidence/implementation/adoption-cancel-*.log`. This qualifies cooperative cancellation at the tested boundaries only. Arbitrary external interruption, browser and live-provider qualifications remain open. No global deferral or full P/A/H obligation is promoted.

## Native assistant command mentions increment

`ChatPanel.commandMentions` pairs a host catalog with its activation callback. Settled assistant Markdown decorates exact registered command names using the pinned v2 boundaries, including boundaries across formatting. Code, links, inline runs containing literal HTML, user messages, streaming text and archived history remain inert. Activation rechecks the current controller and catalog. The callback carries explicit user intent; host execution authorization remains separate.

Public native/DOM tests exercise matching, copy, live native streaming, catalog changes and teardown. Strict isolated archives and the installed shadcn recipe repeat the public behavior, including after copied-source restyling. This is partial P01/A44. File/skill mentions, syntax highlighting, actual browser focus/selection and full editor/chat parity remain open.


## Mounted Markdown commands increment

The optional renderer exposes concrete inspect, selection and heading-navigation commands through `onMountedTools`. The [UI guide](../../packages/ui/README.md#mounted-markdown-commands) owns their API and coordinate rules. Mount/projection identity extends the original exact save target; a surviving controller cannot make an old renderer target current. Human heading navigation shares the command implementation. Read-only selection is supported, and pending frames settle on cancellation, expiry or teardown.

Public React/Tiptap/SQLite tests check actual DOM endpoints, backward ranges, repeated selection, dirty buffers, source shadow roots, remounts and reentrant teardown. A real native ToolTask invokes a captured mounted target through ordinary host registration. Native cancellation and borrowed Harness lifetime are exercised independently. Installed editor archives and the copied shadcn recipe repeat the public controls with strict declarations, including after restyling.

The public tests reproduced native read-only focus limitations. Independent source review found an equal-selection synchronization risk; both versions pass HappyDOM, so its added repeat cases are coverage, not a reproduced browser defect. Runtime fixes use public native selection/focus APIs and verify actual DOM state. HappyDOM's synchronous selection event also exposed direction feedback from directly setting a backward DOM range; native projection now owns direction. Raw failures, reviews and final candidate gates remain under `.cache/evidence/implementation/markdown-mounted-*` and the exact final-candidate directory. These are DOM and in-process native results. Actual browser focus/scroll, remote commands, full P/A/H acceptance and all six release deferrals remain open.


## Proposal line-diff review increment

The optional Markdown editor now presents exact added/removed lines, two lines of context and expandable unchanged runs. Detailed alignment has a 250,000-cell matrix limit; larger changed middles retain all removed/added content with an explicit fallback notice. Original before/after snapshots remain available. The [UI guide](../../packages/ui/README.md#optional-markdown-editor) documents the limit precisely.

Public DOM tests use real controllers and SQLite, reconstruct exact LF/CRLF/EOF/Unicode strings, verify escaped content and large comparisons, and preserve existing stale/readonly acceptance behavior. Review and fold controls perform no writes. Installed editor archives and the copied shadcn recipe repeat the same controls, with scoped host color overrides before/after restyling. These are DOM/installed results; browser accessibility, total-document performance and full P/A/H obligations remain unqualified. No release deferral changes.

## Supported browser environments

Browsers expose `crypto.randomUUID`, `crypto.subtle`, `navigator.clipboard` and `navigator.share` only in secure contexts (HTTPS or localhost). The studio opened over plain HTTP on a private address (Tailscale, LAN) has none of them, so browser-reachable code never calls them directly: `@hachej/boring-files/platform` owns `randomUUID`, `sha256` and `copyToClipboard`, and each registry item keeps one self-contained helper (`copyText` in `utils.ts`; `createLinkShare` in `registry/viewers/share.ts`). Copy and Share fall back from the platform API to a hidden-textarea `execCommand('copy')`, then to a popover that shows the text selected for a manual copy.

| Environment | Supported | Gate |
| --- | --- | --- |
| Secure origin (HTTPS, localhost, 127.0.0.1), desktop | yes | `STUDIO_SECURE=1 npm run studio:journey`, and the secure-origin Share check in the `share-file-link` scenario |
| Insecure origin (plain HTTP on a private address), desktop | yes | `npm run studio:journey` runs here by default (`insecure.test` mapped to the local server) and its first step asserts `isSecureContext === false` and no `randomUUID`, `subtle`, `clipboard` or `share` |
| Phone width (390px) on either origin | yes | studio scenarios `phone-file-viewers`, `phone-chat`, `phone-artifacts`, `phone-queue-history` and `tablet-layout` |
| Static rule | all browser-reachable source | `npm run check` runs `scripts/check-platform-apis.mjs`: no raw secure-context API outside the four allowlisted feature-detecting helpers, `localStorage`/`sessionStorage` only inside `try`, observers behind a `typeof` guard, no hard-coded `localhost` |

## Shipping correctness, 2026-10-05

The shipping fix branch starts at `092cc61`. It binds native question records, browser answers and channel notifications to an assistant entry plus tool call; legacy retries require the original native task binding. Cancellation checks refuse when native task state cannot be read in the caller's transaction. External notification acknowledgement follows successful send, with actual SIGKILL tests for before-send, after-send/before-ack and after-ack recovery. Unacknowledged sends can repeat.

Chat transport refuses raw history for projected callers and checks revocation after request/policy waits and before disclosing pending frames. Studio save replay preserves later working-file edits. Delivery abort reconciliation validates the same admitted receipt evidence as ordinary completion. Registry cards pair results with individual invocations rather than globally reused IDs.

The fake-model browser command is `CHROMIUM=/path/to/chromium npm run studio:journey:correctness` after building. It drives question answers, denied access, lost save acknowledgement, conflict preservation and reconnect, and records exact Git identity. This environment refuses loopback sockets and Chromium startup with EPERM, so adding the command does not establish browser qualification. Raw focused, crash, review and final command results are retained under `.cache/evidence/ship-correctness/`. SVG opening remains unchanged at the user's request. No global proof or complete P/A/H obligation is promoted.


## Current-branch integration and concurrent editing, 2026-10-05

The shipping fixes were integrated onto inspected local commit `ab4abeff7d7d41282fe1727a4a64ffc76c0d40ee` in `/tmp/boring-continue-20261005`, branch `fix/ship-correctness-current-20261005`. This preserves newer Cloudflare/portable SQLite work, `routeSubmissions`, mention preparation and the artifact workspace. GitHub was unreachable; this is not a claim to have fetched current remote main. The requested checkout's unrelated dirty lockfile remains untouched. Integration commits run from `703afd8` through `fb1a9bc`; concurrency fixes and test setup are `a7d768f` and `de48d4e`.

The native concurrency regression starts a human exact flush and an agent ToolTask save from the same revision through independent SQLite connections, then releases each writer first in separate cases. Exactly one commits; the other conflicts without a publication receipt. The original revision and native intent remain readable. When the agent wins, the human draft survives both conflict and refresh. This is controlled overlapping publication, not a claim of simultaneous multi-process SQLite dispatch.

Independent review found that Studio polling could replace a controller after the user edited or started saving during its read. The actual React hook and Markdown controller reproduce the loss before the fix. Polls now serialize and recheck controller state after awaiting the read. DOM tests cover intervening edit/save and normal clean refresh. Both artifact and file viewers use the same hook. The correctness browser fixture now opens the artifact workspace and selects source after launch/reload. A complete Studio browser bundle compiles; loopback sockets still fail with EPERM, so the browser journey remains blocked.

The integrated code passed all 901 tests and development verification before this checkpoint update. Final clean-candidate commands, release results, review, failed reproductions and exact commits are recorded under ignored `.cache/evidence/continue/`; the resumable bundle/report are copied to `.cache/evidence/continue-20261005/` in the requested checkout. A preliminary full run exposed test setup that imported React DOM before creating the test document; lazy import corrected the setup without relaxing assertions. SVG behavior is unchanged. No complete W/P/A/H acceptance or global runtime proof is promoted.

## AWS Code Interpreter environment and host recipe (offline)

`@hachej/boring-execution/aws-code-interpreter` and `examples/aws` implement [HOST-RECIPE-AWS.md](../architecture/HOST-RECIPE-AWS.md) without an AWS account: every proof runs the real `@aws-sdk/client-bedrock-agentcore@3.1146.0` client against `examples/aws/fake-code-interpreter.mjs`, a temporary directory stands for EFS, tokens come from a fictional key pair and the model is scripted. Evidence: `test/packages/execution.test.mjs` (the two Code Interpreter tests), `node examples/aws/journey.mjs`, `STUDIO_VARIANT=aws STUDIO_AWS=fake STUDIO_ONLY=aws-shared-folder npm run studio:journey:scripted`, and `uvx cfn-lint@1.57.2 --regions us-east-1 -- examples/aws/template.yaml`.

SQLite settings: every v4 SQLite opener takes `SqliteSettings` from one module (`@hachej/boring-files/sqlite-settings`, guarded by `scripts/check-sqlite-settings.mjs` in `npm run check`), and the recipe opens every file on EFS with `sqliteSettings.networkFilesystem` (rollback journal, exclusive lock held from open, full sync). Pi's `openNodeSqliteStorage` has no journal, locking or synchronous option (it always sets WAL and `synchronous = NORMAL`); the recipe uses Pi's public `NodeSqliteDatabase` and `SqliteStorage.open` over a database opened by `openNodeDatabase` instead, so the harness files get the same preset without patching Pi. Evidence: `test/packages/files.test.mjs` ("SQLite settings" tests: default stays WAL; the preset yields `journal_mode=delete`, `locking_mode=exclusive`; a second process gets `SqliteLockedError` after its busy timeout and the file stays intact; invalid values refused; Pi's storage under the preset) and the journey's state-file step, all on local disk. Not claimed: behaviour or latency on real EFS, and whether NFSv4 lock state survives an EFS client failover.

**A live AWS run is pending (needs an account).** Its exact commands are in [examples/aws/README.md](../../examples/aws/README.md#live-run-pending-needs-an-aws-account); until it passes, nothing about service behaviour (getTask output shape, header pass-through, NDJSON streaming through `InvokeAgentRuntime`, `HealthyBusy` past the idle timeout, SQLite on EFS, cold starts, costs) is claimed, and the HOST-RECIPE-AWS acceptance journey (real browser, real model, session stop and version update) is not run.

## Isolated consumer repair (2026-10-07)

Every `test:*-consumer` script now passes (`test:testing-consumer` needs `CHROMIUM`). The ten faster ones (about 5 minutes) run in the `Isolated package consumers` job of `verify.yml`; registry, projection, definitions and testing consumers stay manual. Seven had failed on main. The headless experience entries imported `randomUUID` from `@hachej/boring-files/platform` although they promise to load without files; they now use an opaque `crypto.getRandomValues` id. The remote shell/files and question-response subpaths read request bodies through `@hachej/boring-files/request-guard`, the one owner of bounded body reads, so their consumers install the files archive (still an optional peer, needed by those subpaths). The virtual consumer copies the AWS fake its execution tests import. The canvas consumers set `skipLibCheck` for tldraw's own declarations (the lodash and `ArrowShapeUtil` items above remain upstream) and fail on any library diagnostic outside them. Consumer installs prefer the npm cache but may reach the registry (`npmInstallFlags` in `scripts/consumer-isolation.mjs`); the copied root lockfile keeps them exact, and all ten CI consumers pass from an empty cache.

## Shared canvas document edits (2026-10-08)

The optional [headless document API](../../packages/ui/README.md#headless-canvas-document-edits) now validates native schema/records and complete parent/binding graphs, then applies detached native-record create/update/remove batches. The controller and saved-resource example tools share that implementation. Invalid remote documents preserve the draft and base; failed saved reads do not advance the conversation's publication baseline. Descendant deletion includes attached arrows.

Focused public-output/native SQLite tests and the installed canvas consumer are the evidence entries in [FEATURES.md](FEATURES.md#shared-canvas-document-edits). Exact commands, results, review and candidate are recorded under ignored `.cache/evidence/canvas-document/`. Local proposal review/adoption and its browser journey are tracked in the next increment; saved-tool lost-ack/crash recovery remains open. W/P/A/H coverage and all global deferrals remain partial and unchanged.

## Canvas proposal adoption (2026-10-08)

The [proposal API](../../packages/ui/README.md#canvas-proposals) and [feature evidence](FEATURES.md#canvas-proposal-adoption) now cover detached native candidates, human field review and exact acceptance over the shared publication buffer. Mounted commands add native page/mount and read-only restrictions. Reentrant edits and late acknowledgements retain newer drafts. The browser journey uses fictional authenticated resources, actual SQLite and native Editor calls, with review actions through browser controls.

Exact candidate gates, independent review and raw results are retained under ignored `.cache/evidence/canvas-adoption/`. Local loopback policy can block the browser server; only an actual CI browser run qualifies that journey. Saved-tool recovery is tracked below. Production canvas requirements, W/P/A/H coverage and global release deferrals remain unchanged.

## Saved-canvas tool recovery (2026-10-08)

The saved tools now retain exact publication intent in native task memos and reconcile a potentially committed operation without another write. Focused execution passes 59 tests, including 26 real SIGKILL cases. Later human edits and newer conversation reads survive recovery. See [feature evidence](FEATURES.md#saved-canvas-tool-publication-recovery) and [host requirements and limits](../architecture/CANVAS.md#saved-tool-publication-recovery).

Exact candidate gates, baseline comparisons and independent review remain under ignored `.cache/evidence/canvas-recovery/`. Local network/process restrictions remain visible in full-gate results; no failing gate is relabelled as a pass. Production canvas requirements and all global release deferrals remain open. This checkpoint remains PARTIAL across W/P/A/H.

## Consumer task-list candidate, 2026-10-08

The branch based on PR 47 adds the optional public text-buffer entry, an actual consumer-defined task-list feature/controller/renderer and native saved-resource tools. It reuses the existing buffer state and conditional publication contract. There is no new plugin runtime or application file-type switch. Review reproduced and fixed refresh overwriting an edit made by its synchronous replacement callback; the same fence protects disposal.

Independent review also found hidden resolved refresh refusals and an unfinished task title carried across controller replacement. Both have renderer fixes and real React/SQLite regressions. Explicit Abandon save preserves an unreceipted draft without replay.

Fourteen focused task-list tests pass, including six real SQLite/SIGKILL recovery cases. Successful recovery returns the original receipt/document even after a newer human publication. Changed binding/actor, revoked authorization and missing receipts never republish. Public buffer and existing HTML/canvas regression checks pass. Registry installation/restyle/native tests and actual browser journeys are required integration gates, with final results retained under `.cache/evidence/custom-task-viewer/` in the implementation checkout. Loopback restrictions prevent local browser execution; CI must establish that claim.

W10/A43/A46 remain partial. Full P01-P14/A01-A48/H01-H10 remain in scope; no VERIFY.json deferral is removed. Hosted recipes, live identity/provider/model behavior, human/expert review and tldraw production licensing/assets remain separate qualifications.


## Fictional morning experience candidate, 2026-10-08

The candidate adds concrete email, calendar and todo services, native preparation tasks with a dependent merge, and an experience that calls each owning service. Send atomically queues a fictional outbox record against exact saved draft and email revisions. It does not deliver external email. Native action and preparation recovery retain their request and reconcile without replay after an attempted publication. Restricted draft/layout clients cannot write another resource.

The generated decisions region receives registered references and enumerated metadata. Private fixture data stays out of its inputs and browser bundle. The fixed Markdown editor preserves its controller and local draft through proposals. Expand/Focus are local controls. Current authorization is checked by services and composition callbacks; this is not atomic authorization across independent external systems.

Independent review found committed retries reported as denied, mutable exported locators, a lookup error misreported after publication, and loss of a leading Unicode byte-order mark. Regression tests cover their fixes. Focused runtime tests include eight real SIGKILL cases. The installed consumer runs the concrete example against package tarballs, native tasks and React controls. `morning:journey` is the separate actual-browser gate; DOM tests do not establish that claim. Candidate command results and review evidence live under ignored `.cache/evidence/morning-experience/`.

W11 and A25-A32 remain partial. Live application connectors, evaluator quality, externally scheduled morning preparation, human acceptance and deployment require separate qualification. Full P01-P14/A01-A48/H01-H10 remain in scope, and no global VERIFY.json deferral is removed.

## Fictional consultation browser candidate, 2026-10-08

The candidate composes the existing redaction fixture with concrete Markdown controllers and semantic proposal/correction cards. Two consultations own separate native runtimes. Each consultation keeps independent A/B/C generations. Generation requires the receipt for the exact selected notes buffer; later typing stays local. Source-mode dictation retains its consultation, mount, buffer and cursor, and a stale transcript remains available for inspection.

Adoption checks the displayed correction, record and letter revisions before native admission. The client verifies publication receipts against the selected text. Browser mutation IDs bind the authenticated actor, consultation and semantic arguments; they do not attest a malicious host. Read-only latest-request discovery observes reservations and native bindings without starting work, including after actual process death. It preserves the original actor and request for an explicit retry.

Focused native tests, real SQLite DOM controls, an isolated tarball consumer and the actual Chromium journey establish separate claims. Independent review covers late proposal replies, typing during adoption capture, unresolved request retention and stale client review caches. Exact command results, failed probes and corrected runs stay under ignored `.cache/evidence/redaction-browser/`. Run `npm run redaction:browser` after building; the [example guide](../../examples/redaction-browser/README.md) describes the controls and test commands.

This increment addresses bounded fictional R03-R06/R08/R11 behavior. W12 remains partial. Full P01-P14/A01-A48/H01-H10 and every global VERIFY.json deferral remain unchanged. The generated preparation region, live transcription and model quality, real identity/provider policy, clinical expert acceptance and consumer migration still require their own qualification.

## Fictional preparation experience, 2026-10-08

Branch `feat/redaction-preparation-20261008` starts at reviewed PR50 commit `202d3eb`. It adds native typed preparation, actual source-return validation, independent conditional delivery and a fixed six-section experience above the notes. The evaluator receives twelve individual card candidates with enumerated metadata only. The host preserves complete sections and recent chronology. Preparation observation, composition offers and local adoption retain their original request/revision targets. Notes and A/B/C corrections retain their own authority.

The [feature entry](FEATURES.md#fictional-preparation-experience) names native, crash, installed-consumer and browser gates. Raw results and independent review belong under ignored `.cache/evidence/redaction-preparation/`. Local loopback EPERM prevents actual Chromium execution in this environment; CI execution is recorded separately. Final checks compare local test failures with the same-base baseline rather than treating an environment failure as a pass.

W00 remains reconciled; W01-W08/W10-W13 partial; W09 a public-seam probe. Full P01-P14/A01-A48/H01-H10 remain the target. Eleven global VERIFY.json deferrals remain unchanged. Live model/transcription quality, clinical expert acceptance, production identity and processing policy, licenses and consumer migrations are not established by fictional preparation fixtures.
