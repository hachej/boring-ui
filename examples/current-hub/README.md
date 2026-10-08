# Fictional current-hub companion

This executable host composition covers part of [H10/A48](../../docs/compatibility/HUB-M1.md#current-hub-composition-qualification-h10). It uses three native Harness instances, one companion and two fictional apps. Each app owns its native SQLite storage, private definition, input, producer, native report tool, delivery and published resource. The companion borrows app invocation capabilities and retains permitted references.

## Run

From the repository root:

```sh
npm run build
node examples/current-hub.mjs
node --test --experimental-test-isolation=none test/compatibility/current-hub.test.mjs test/compatibility/current-hub-definitions.test.mjs test/compatibility/current-hub-crash.test.mjs test/compatibility/current-hub-cells.test.mjs test/compatibility/current-hub-handoff.test.mjs test/compatibility/current-hub-handoff-crash.test.mjs
npm run test:definitions-consumer
npm run test:experience-consumer
```

The demo invokes both report tools, files one fictional change request through a native tool and prints authorized references and owner observations. It uses disposable local SQLite stores and no model. Tests also run a native conversation with a fictional local model that calls both tools.

## Pinned definitions and native execution

The demo explicitly provisions fictional `agent.json` resources through `definition.mjs`. Opening an app neither installs a definition nor resumes tasks. First admission loads an authorized exact revision through `@hachej/boring-agent/definitions` and resolves its declared `prepare_report` tool. One native transaction configures the conversation, retains the definition binding and admits the request. A final permission check rolls back configuration and tasks if authorization changes during admission.

Later admissions and recovery use the retained revision, scope, digest and host/tool implementation versions. A newer `agent.json` cannot redirect existing work. Changed implementation identity or native configuration refuses without rewriting the original configuration. Definition reads, execution, observation and publication have separate host policy decisions.

The producer creates an actual native `ToolTask` owned by that request. The tool checks its original producer, reloads the pinned definition under current permission and uses the configured native instructions. It repeats those checks inside execution so recovery from durable execute intent cannot skip authorization. Its bounded private text passes to the existing validator and conditional document delivery. The companion receives no definition or report content.

## Ownership and request binding

`app.mjs` implements the fictional app boundary. A native document atomically binds the canonical request, authenticated actor, installation and producer/delivery pair. Duplicate requests return that binding; changed bodies conflict. A durable storage incarnation distinguishes different native stores even when their numeric task IDs coincide. Publication uses the existing document delivery extension and a SQLite workspace per scope ([`../shared/sqlite-workspaces.mjs`](../shared/sqlite-workspaces.mjs)); revisions are Git blob ids of the bytes.

`companion.mjs` installs two native tools, each bound to one app instance. The host resolves identity; tool arguments cannot choose it or select an endpoint. Returned references must match the captured app, runtime, incarnation, capability version, actor and request. The tool constructs its response from permitted scalar fields. App errors and unsolicited result fields are excluded.

The native tool memo retains the original invocation binding. A changed binding after interruption returns `unknown` without invoking another app. A lost acknowledgement or authorization change after dispatch also returns `unknown`. A denied retry does not erase previously admitted work. Observation reports the native delivery task status separately from its publication outcome; an unavailable app never implies cancellation.

The exported `.local` handles are privileged fixture inspection access. They are not a remote API or companion tool result. The fixture's synchronous policy callback and fixed actors stand in for trusted host authentication; they do not implement an identity provider or an atomic external revocation service.

## Fixed two-app view

`fixed-view.mjs` exports `createFixtureHubView({ apps, actorFor, canView })`, which returns a stable React component using the existing `Experience` renderer. The host supplies the two app clients and live identity/visibility callbacks. Each status cell routes **Run report** and **Check status** to its owning app. It displays only selected reference fields and known native/publication states. A failed observation reports unavailable; an invocation with a lost acknowledgement reports unknown and retries the same request ID.

The two public status shells render independently, so a denied app does not hide the other. App visibility is checked inside each shell and before/after every asynchronous call. The host must rerender when actor or visibility changes; this fixture does not subscribe to an authentication service. A new factory is required to adopt a different app incarnation. Rendering, remounting and hiding cells dispatch nothing. Unmount invalidates pending UI replies and leaves the borrowed apps running.

The driven test mounts real React/json-render in HappyDOM with two native SQLite apps, drives both buttons, verifies same-request recovery and completes a gated producer after the view unmounts. Controlled response wrappers test forged/mutated references, unsolicited fields and lost acknowledgements. The module imports no native or server code; the isolated experience archive also bundles this exact view. These are DOM and bundle checks, not an actual browser journey or remote authentication qualification. A browser host must supply its own authenticated clients rather than native SQLite handles.

## Change-request handoff

`change-path.mjs` owns a separate `changes.sqlite` provider and borrows its app. Explicit `stage` writes the person's fictional words directly to that owner and returns an exact resource reference. `request_change_amber`/`request_change_blue` carry only that source reference and an authorized report reference through the native companion. The optional tools install through ordinary native registration; a path from another app incarnation is rejected.

The owner reads the exact staged revision, checks the context at its app and publishes one deterministic issue record plus its receipt in one SQLite transaction. The record contains the person's words, original references, actor, fixed fictional repository, `boring-factory:triage` label and `fictional-hub:reports` backlink. Same-request retries reconstruct identical publication bytes; the provider enforces the argument digest. Changing the source or context conflicts. A newer staged draft cannot redirect an existing request.

Only validated issue/receipt references return to the hub. `readIssue` verifies the original creation receipt and immutable binding, then reads the owner's latest `open`, `in-progress` or `shipped` status. Privileged fixture tests use `local.provider` to change status with exact revision checks. The hub keeps no authoritative copy of status, words or issue content. Closing this path closes only its provider.

Three additional child-process cases use real SIGKILL after issue commit and before native tool acknowledgement. Recovery either returns the original issue/receipt, or preserves uncertainty under revoked draft access or a changed actor without another issue. A held-memo callback test separately checks synchronous input capture; it is not a crash substitute. A thrown context observation before publication returns unavailable, while possible publication or previously dispatched replay remains unknown.

This is a fictional owner-local issue store. It does not file an external repository issue or establish GitHub delivery/idempotency. Cross-app context is refused because the pinned owner leaves pair/workspace sharing unresolved. Production identity, external revocation fencing and the actual `changePath` adapter require separate qualification. No builder, approval, merge or deployment operation is part of this handoff.

## Evidence and limits

The tests inspect native entries, task records, submissions and materialized current documents in session, conversation and task scopes. They capture fake-provider prompts and scan disposable SQLite/WAL files for planted literal ASCII markers. Both apps retain their own definition/input/result markers; the hub retains none. The scanner detects a deliberately planted native tool result as a negative control. This is literal-marker and current-record evidence, not a proof about every encoding, historical record format, external log sink or cache.

Seven child-process cases use actual SIGKILL. Two recover app admission before acknowledgement with the same producer, delivery, receipt and revision. Three recover an interrupted companion ToolTask with changed/missing identity or revoked app policy and confirm no new app invocation. All five preserve the original definition after a newer revision appears. Two additional cases kill the report tool at durable execute intent. Recovery either completes the same child using the original definition or refuses a revoked definition read without publication. The revoked case deliberately calls privileged local resume as a negative probe of the execute-body guard; normal admission already refuses it. These cases qualify the named local SQLite composition, not remote network behavior.

The installed archive recipe copies the native definition, invocation and handoff fixtures outside the monorepo, installs only the files/agent packages and their dependencies, runs strict declaration checks and repeats the native, definition and crash tests. The large-definition case checks exact output beyond the native tool's default line limit.

The owner baseline is hub SPEC revision 6 at `3c5b9adfc08525594dc071f824813a8708d0e3f5`. This fixture is version 2. Its native instance document refuses version 1 storage because old work has no qualified definition binding. This is a disposable fixture boundary, not a consumer migration. The existing runtime identifier and companion capability protocol remain version 1; native dependencies are pinned by the repository lockfile, including Pi durable/AI 1.0.0. Exact library candidate commits and command results are recorded in `.cache/evidence/implementation/RESUME.md` and `checkpoint-status.json` after verification.

Full H10/A48 remains incomplete. External change-path delivery, cross-app reference sharing, browser/wire compatibility for the fixed app actions, real authentication and the consumer-owned integration still need evidence. Historical Factory H01-H09 and redaction R01-R11 remain separate obligations. No consumer repository, deployment, private corpus or production service is used.
