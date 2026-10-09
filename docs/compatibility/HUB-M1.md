# Consumer compatibility: current hub and historical Hub M1

Status: accepted owner migration, not executed compatibility. The current hub source is revision 6 at [3c5b9adfc085](https://github.com/hachej/boring-hub/blob/3c5b9adfc08525594dc071f824813a8708d0e3f5/SPEC.md). It separates development Factory responsibilities from the hub. This document changes no consumer repository and certifies no implementation.

## Current consumer ownership

| Consumer | Owns | Library qualification boundary |
| --- | --- | --- |
| boring-hub revision 6 | Registry/identity/installations, authorized app capability invocation, companion, workspace files/file apps, fixed/derived/generated cross-app UI, change-request handoff | Identity/projections, truthful native/task/provider references, file/viewer composition and permitted data residency; no remote builder or deployment prerequisite |
| boring-factory and app repositories | Discovery/claims/workers, verification, approvals, merge/release/deployment | Remote execution, protected verification and publication under the actual Factory/app contract; pin that contract independently |
| boring-stack | Expert and worker skills | No runtime ownership; skill installation cannot manufacture tool authority |
| Embedded app | Domain records/services, private inputs/results, host policy and acceptance | Native background tasks and optional question/validation/delivery without hub/browser/files required |

H01–H09 below retain their historical revision-5 definition and evidence provenance. H02–H04 mechanisms remain useful for Factory/remote consumers; H05/H06/H08 have reusable native/app parts. H09 remains the historical Factory-style interview-to-release scenario, not a current hub responsibility. Do not relabel A39 or any old test pass as new-hub conformance. Native business/execution graph and cancellation issues still require their own consumer tests where present.

## Current hub composition qualification (H10)

H10 is a new consumer-owned scenario mapped to A48. Pin hub/library/app/provider/spec versions and use two disposable app fixtures. Verify actor/installation provenance, declared capability admission, same-request idempotency and changed-body conflict; truthful status/receipt references; authorized initial and subsequent observations; denied cross-app references; file-app definitions resolved as pinned data; fixed multi-app cells with each action routed to its owning app; companion invocation and one change-request handoff. No builder/merge/deploy operation or credential belongs to this scenario.

Inspect native transcript/documents, prompts, logs, exports and caches for planted private input/results. A reference-only Hub Job table does not prove that raw tool returns were not persisted by a native companion. Honor the hub's current no-app-content policy by data-owner execution/permitted references; any wider retention requires a separately approved owner change, not an implicit library exception. Test mid-stream permission changes, unavailable app/cancel observations, wrong task/scope/version replay and reload without duplicated effects.

Test consumer composition, not a new agent engine. The hub's manifest/business graph must not shrink native dynamic tasks; an unavailable remote app is not proof of execution termination. External custom code remains in the agreed isolated frame path. Client/wire version disagreement reports an explicit unsupported path and preserves drafts. H10's minimal fixed view does not complete optional generated-layout, full chat or Factory qualification.

The [fictional companion fixture](../../examples/current-hub/README.md) now exercises reference-only native invocation, pinned data definitions driving native tools, actor/installation bindings, reauthorization, local SQLite admission/tool recovery, fixed app action routing in a driven DOM fixture and a source-owned fictional issue handoff. Its retention scans use planted literal markers and a leaking negative control. This is partial library-composition evidence, not current consumer compatibility or full H10/A48. Actual browser/remote integration, the external change-path provider, cross-app reference sharing and the remaining owner requirements above still apply. The fixture definition checks do not establish the consumer registry or remote file-app integration.

## Historical contract and migration record

The following is preserved historical Hub M1/1 text. Its references to hub-owned approvals/builders/release describe revision 5, not current ownership. It is retained for provenance and reusable mechanism tests; a current task packet must use the owner map above. Nothing below is an executed pass or authorization to put Factory back inside the hub.

---

## Historical Hub M1, revision 1

Status: accepted design scope, not implemented compatibility. No runtime/provider is qualified. “Supplies Hub M1/1” requires the library/adapter proofs and the consuming hub's end-to-end acceptance against named revisions. Qualification always includes the tested specification revision, not only this subset label.

Original design baseline: hub SPEC revision 5 at `eb2273d5cd7967546c45903bfcf01365fa225e73`; v4 main was `d025fe56b7291fd842f3a404e9e3000604dd8611` when acceptance began. Composition/invariant reconciliation additionally inspected hub main `51550cd1d25d8c20fe4def75dd87ae2995ff2a06`, v2 `62eaa783257c7126dcdfe798cd09b83cf9633de8` and the Pi environment source pinned in [FILES-GIT-EXEC.md](../architecture/FILES-GIT-EXEC.md). These are source/spec reviews, not executed hub compatibility evidence.

[HUB-FACTORY.md](../stress-tests/HUB-FACTORY.md) remains broader consumer input. This file accepts portable requirements, not every vendor/default request. Mechanisms and laws are owned by [SPEC.md](../architecture/SPEC.md), [CONTRACTS.md](../contracts/CONTRACTS.md) and [INVARIANTS.md](../../INVARIANTS.md). This map does not introduce services, another runtime, or duplicate law definitions. Updating it does not modify the hub repository.

## Ownership

Pi owns native execution, descendants, waits and recovery. Boring supplies optional native extensions, resource/transport/environment adapters and UI. The hub owns product approval, claims, business priority/dispatch, candidate/verdict interpretation, merge/release policy, inbox and expert acceptance. Working/resource providers own their actual data/identity/lifecycle/publication guarantees; the clinic keeps its domain data and deployment.

A business queue chooses approved work; it does not schedule native execution phases. A fixed set of business deliverables does not freeze Pi's internal dynamic task graph. Product approval is a hub record, not a copied runtime question. One owner integrates cross-package admission/question/delivery contracts; other builders work behind tested interfaces. Pure providers and viewers remain usable without the hub or a Boring-owned Harness.

## Accepted map

Paths below are obligations, not existing tests. Core is reusable native integration; M1 is an early qualification composition, not completion of every viewer/provider/migration.

| ID | Accepted portable scope | Owner | Gate | Executable proof to land |
| --- | --- | --- | --- | --- |
| H01 | Native task/conversation identity, authenticated submit/watch/status/cancel, selected input/config/digest binding and request deduplication. Business obligations remain distinct from dynamic native descendants. | Native adapter + host policy; Pi lifecycle | core | `node --test test/compatibility/hub-admission.test.mjs` |
| H02 | Immutable input snapshots, private working views, coherent VFS/Bash/Git access and conditional multi-file publication or honest partial outcome; read dependencies and rejected proposals retained. | Resource/working providers + publication binding | M1 | `node --test test/compatibility/hub-workspace.test.mjs` |
| H03 | One acquired remote workspace with native file/shell semantics, provision/reattach/expiry, independent grants, bounded output, ports, honest cancellation and separately authorized branch publication. | Qualified provider; host chooses vendor | M1 | `node --test test/compatibility/hub-remote-workspace.test.mjs` |
| H04 | Protected candidate/test inputs throughout verification, separate writable outputs, no publication capability and evidence bound to actual executed inputs. | Provider/runner qualification; hub verdict | M1 | `node --test test/compatibility/hub-verifier-integrity.test.mjs` |
| H05 | Original runtime question projected in the hub; authenticated delegated answer to the exact task/scope/version/expiry survives both services restarting. | Optional native question + delegation binding | core + M1 | `node --test test/compatibility/hub-remote-question.test.mjs` |
| H06 | Producer plus delivery obligation admitted together; crash recovery reconciles provider commit into one accepted host outcome. Private content stays with the authorized data-owning runtime. | Optional native delivery + idempotent host provider | core | `node --test test/compatibility/hub-delivery.test.mjs` |
| H07 | Minimal chat/progress and opt-in isolated interactive HTML; viewer/resource operations versus presentation commands; independent attachment lifetimes. | UI/resource/transport + host policy | M1 | `node --test test/compatibility/hub-mockup.test.mjs` |
| H08 | Public-seam model admission for each claimed guarantee; truthful usage/unknown outcomes. Unsupported strict transport guarantees refuse qualification, not unrelated native work. | Host/provider; Pi generation | core | `node --test test/compatibility/hub-model-admission.test.mjs` |
| H09 | Interview→approved payload→claim→candidate→independent verification→expert trial/acceptance→authorized release receipt. | Hub/application integration, not library orchestration | hub acceptance | Consumer-owned executable journey records hub/v4/provider/candidate/spec revisions. |

Vendor choice, subscription credentials/pricing and business scheduling remain host decisions. Remote adapters reuse native FileSystem/Shell/ExecutionEnv where appropriate and add missing lifecycle/identity behavior, not a second exec API. Fixtures distinguish core conformance, live provider qualification and business acceptance.

## Snapshot, dependency and refresh contract (H02)

Each reproducible attempt has immutable inputs. Refresh preserves unfinished overlay/diff and old dependency evidence as a proposal, then starts a new attempt. It cannot relabel old derived work as based on the new head. Deliberate adoption/re-derivation records fresh dependencies and approval applicability. This supersedes the baseline hub wording that refresh moves the existing attempt's snapshot; the consumer must adopt the rule before qualification.

Dependencies include content, directory listings, search predicates and observed absence, at declared granularity. A new matching file invalidates an affected decision. A provider can conservatively fence a subtree, but Hub M1 also requires the hub's disjoint unchanged-input/write publication case. Safe whole-repo rejection of every unrelated edit is not that qualification.

The expert's published view and each task's private working view are intentionally different. File tools/Bash/Git/viewers bound to one view agree; other tasks cannot see or commit its staging. Resource/view/scope/provider-instance identity prevents path-only cache or reattachment confusion. A copy-on-write lower layer is only a snapshot if pinned; memory is only durable if actually persisted.

Validate relevant inputs and targets at authoritative publication. Ordinary working writes have normal environment semantics; a receipt is for the actual managed publication, not every scratch byte. Atomic batches, lost-response lookup and revocation fencing require actual provider guarantees. A Git commit or push acknowledgement alone does not establish all of them. Rejected overlays stay inspectable; cancelling one task does not discard another view.

Tests: shared-view coherence; separate overlays and published view; disjoint safe commits; changed read/listing/absence; refresh cannot hide old provenance; `.git` cannot bypass withheld mutations; conditional ref/batch conflict and lost acknowledgement; provider swaps preserve semantics or refuse qualification. No duplicate filesystem engine or UI write path is introduced.

## Verifier integrity (H04)

“Cannot push” is necessary, not sufficient. Protect source, tests, command/config and declared verification inputs during execution with provider-enforced isolation. Separate permitted dependency/cache/build/report outputs under the verification template. The agent cannot disable/reconfigure the protection. A before/after hash is supplementary, not defense against temporary edit-and-restore.

Record actual tree/input snapshot, candidate, command/template, environment/build/config identities and evidence references. Modified scratch investigation cannot qualify the original candidate; repairs become findings/new candidates. Exercise both native command and file RPC paths. Refuse providers unable to protect required inputs. Hub policy decides whether qualified evidence satisfies the business verdict; Boring supplies no substitute expert/technical approval.

## Remote question versus product approval (H05)

The inbox projects the original runtime question, not an independently resolvable copy. Resolution binds runtime/native task/conversation/question, operation/subject/digest/revision, authorized responder/scope/expiry and idempotency. Validate authenticated service delegation and human provenance; caller-supplied person ID is not evidence.

Resolve the original native request by compare-and-set. Duplicate is harmless/already-resolved; cross-task/scope/version or expired replay is denied. Both services can restart before the expert answers. Native waits/tasks resume the original work; an open browser or process-local waiter is unnecessary.

Clarification, viewer patch acceptance and product approval are distinct. The hub decides whether a clarified requirement changes its approved payload and blocks continued dependent work until approval is valid. The runtime carries/rechecks required input authorization without reinterpreting product policy. Browser detachment never silently withdraws a durable decision or stops unrelated background work.

## Minimal UI and truthful states (H07)

Native progress, provisional output, validated result, pending delivery, published revision, stale proposal and product acceptance differ. Keep the last valid result while replacement work runs. Rendering/reconnect cannot execute actions. Multiple personas share authorized resources, not accidentally shared grants/history. Full mature chat/viewer delivery remains A40–A47, beyond the minimal M1 UI slice.

Interactive HTML is opt-in: isolated frame, no same-origin privilege/credentials, constrained assets/egress. A needed bridge uses a fresh frame nonce/MessageChannel with bounded schema-validated non-authoritative messages, retired on navigation/reload. Cross-frame impersonation fails. Passive HTML stays the library default. Headless saved-resource operations need no browser; live focus/selection commands cannot claim success while disconnected.

## Hub invariant specializations

These are migration prerequisites for the consumer, not copied library laws or claims that hub code is fixed. The source baseline is [hub `51550cd1d25d`](https://github.com/hachej/boring-hub/tree/51550cd1d25d8c20fe4def75dd87ae2995ff2a06). Extend the hub's existing law index/provider fixtures with the v4 prerequisite and actual integration evidence; do not add a global invariant service.

| Hub owner/rule at reviewed baseline | Compatible specialization of v4 | Required negative case |
| --- | --- | --- |
| [JOB-2/3](https://github.com/hachej/boring-hub/blob/51550cd1d25d8c20fe4def75dd87ae2995ff2a06/hub/jobs/INVARIANTS.md), native graph/completion | Predeclared business deliverables remain separate from native dynamic descendants; detached/background work retains explicit native ownership. | A native child created after admission is observed, not rejected for absence from the business manifest. Ordinary stop does not falsely terminate detached work. |
| JOB-3 with [COMPOSE-4](https://github.com/hachej/boring-hub/blob/51550cd1d25d8c20fe4def75dd87ae2995ff2a06/hub/compose/INVARIANTS.md), cancellation mirror | Distinguish requested/acknowledged stop and confirmed native/provider termination. Business withdrawal is separate from execution fact. | Drop cancel/status responses while remote work continues: no invented terminal state; reconcile after reconnect and never replay a stop onto newer work. |
| JOB-6 / approval owner | Product approval binds the behavior-bearing canonical payload and applicable candidate/evidence, not every operational metadata edit. Runtime questions remain separate. | Behavior change invalidates dependent authorization; status-only edit does not; stale/cross-subject approval cannot authorize publication. |
| [File/provider laws](https://github.com/hachej/boring-hub/blob/51550cd1d25d8c20fe4def75dd87ae2995ff2a06/hub/files/INVARIANTS.md) and legacy port storage details | Retain revision/conditional-commit/evidence properties; SQL-specific formatting/transactions qualify that provider, not Git or all Boring resources. | Lost Git acknowledgement, concurrent publication and readonly bypass need their own proofs; old SQL tests do not certify them. |
| Hub SPEC refresh | Adopt H02's new-attempt rule and keep original dependencies/proposal. | Read A, derive edits, refresh to B: old work cannot publish as though derived from B. |
| COMPOSE-6/7 private inputs/results | Hub retains references/digests; data-owning runtime retains authorized payload and recovery. | Crash before dispatch resolves the original authorized versioned input or reports resubmission needed; a digest alone is not input and private content is not silently copied into the hub. |
| Platform/ports and composition owners | Business effect rules match the revised hub model; narrow file/shell ports can share one acquired workspace. Boring adds no engine to satisfy obsolete folder-app assumptions. | Independent port construction cannot pair local files with another remote machine; detaching a viewer cannot dispose the task's borrowed handle. |

The reviewed hub cancellation implementation and legacy graph/revision rules require consumer work, even though the intended newer architecture fits v4. Keep old implementation evidence with its original scope; do not rename it into passing native/Git compatibility. H09 remains blocked until the relevant consumer contradictions are resolved and tested.

## Qualification and sequence

1. Prove public-seam native integration, model admission where required and optional producer/question/delivery with hard process kills, not just orderly close/reopen.
2. Run the three reference applications in [PI-COMPLEMENT.md](../architecture/PI-COMPLEMENT.md#three-reference-applications): remote coding, background app without browser/files, and assistant beside an existing app. No application becomes a mandatory base runtime for the others.
3. Qualify H01–H08 in the early M1 composition with the workspace/provider/identity and cancellation negatives above. Do not wait for full clinic migration, every viewer or a complete registry to begin this lane; do not call the minimal lane full UI/product completion.
4. Complete the consumer-owned H09 business journey plus full required UI/provider/migration scope. Preserve P01–P14 and A01–A47, with opt-in code-mode A14/A22 qualification. Library conformance, live vendor proof and expert acceptance remain separate.

Use disposable repositories/workspaces and fictional data. Production rollout requires the host's deploy authorization, never a library test changing clinical production. Qualification names exact tested library, hub, provider, specification and candidate revisions, with evidence—not similar method names or a claim that Pi tasks alone guarantee every external effect.
