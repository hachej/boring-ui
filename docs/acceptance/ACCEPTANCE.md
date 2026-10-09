# Acceptance plan

Status: required journeys with partial runtime evidence. Implemented slices and executed package, crash, DOM and isolated-consumer tests are indexed in [PARTIAL.md](../implementation/PARTIAL.md). No complete acceptance journey is promoted by that partial evidence. See [SCAFFOLD.md](../contracts/SCAFFOLD.md) for the implemented evidence scope. Existing-app and upstream feasibility evidence is separately scoped in [BASELINE.md](../stress-tests/BASELINE.md).

## Evidence levels

Document/link and bounded source/dependency/mutation checks establish only structural claims in [VERIFY.json](../../VERIFY.json). Fake-model tests establish plumbing only for actual introduced integration code. Driven browser controls plus stored records establish consumer behavior. Hard process kills qualify restart windows. Live provider tests, real-model judgment and product-owner acceptance remain separate. A lower evidence level cannot substitute for a higher one.

Root [INVARIANTS.md](../../INVARIANTS.md), [LAWS.md](../LAWS.md), ARCHITECTURE.json and VERIFY.json retain the native/composition boundary and six deferred runtime proof slots. Structural type-reuse tests do not certify working environments or browser bundles. Applicable code needs genuine contract evidence; release verification fails on pending obligations. Implementation adds real lint/typecheck/integration controls and feature maps, preserving law ownership and IDs. Raw evidence stays ignored under `.cache/evidence/`.

The three reference applications in [PI-COMPLEMENT.md](../architecture/PI-COMPLEMENT.md#three-reference-applications) are mandatory composition targets within existing P01–P14/A01–A47: remote coding with coherent acquired environment; embedded background native work without browser/files; assistant beside an existing app with optional resources/viewers. They are not three runtime implementations or another acceptance framework.

## Required generic journeys

| ID | Trigger | Evidence at the authority |
| --- | --- | --- |
| A01 | Attach to host-created Harness beside an existing backend, no mounts/exec; run background app work with no browser/chat. | Host auth/database/routes/native configuration unchanged; installed tool executes; denied caller reads nothing; no mandatory UI, file store or execution environment. |
| A02 | Two private scopes plus one deliberately shared scope, distinct initiators. | No cross-scope read/submit/asset/decision; explicit shared visibility and separate people in evidence. |
| A03 | Retry same request key/body, then changed body; kill during admission. | One original native target for identical retry; changed body conflicts; recovery allocates no orphan second task. Authorized input can be recovered, not guessed from its digest. |
| A04 | Kill during generation/tool work, reopen; compact/reset/fork. | Native recovery/typed interruption; effect evidence retained; no copied usable grants or second scheduler. Ordinary native capability remains available after attachment. |
| A05 | Required budget/revocation denial during retry, repair, compaction and recovered work. | Demonstrated public provider/operation boundary sends no corresponding denied request/commit; unsupported strict guarantees refuse that use, not unrelated native work. Usage is deduplicated or explicitly unknown, never inferred from a throwing observational hook. |
| A06 | Crash before external commit, after it and before native acknowledgement. | Stable operation ID reconciles actual provider receipt/outcome; uncertain weak effects stay unknown. Ordinary scratch I/O is not falsely called a transactional publication. |
| A07 | Two simultaneous approval answers, stale revision, expiry and forked history. | One authenticated resolution/consumption; no copied/reusable/stale authority or product approval inferred from a clarification. |
| A08 | Install native delivery; producer completes, hard-kill before host delivery and after provider commit/before acknowledgement. | One accepted host outcome after recovery, not one physical call. No browser or completion callback required. Private payloads remain with their data-owning runtime. |
| A09 | Two generations and a human edit race. | Per-subject identities protect siblings and human content. Stale publication refused; proposal and deliberate adoption remain separate. |
| A10 | Disconnect, slow watch and reconnect. | Authorized resnapshot and accurate active/delivery state; rendering/replay does not invoke effects or recreate a transcript authority. |
| A11 | Edit then immediately request work; save fails/conflicts or later typing races its acknowledgement. | Flush acknowledges the selected input snapshot or blocks start; buffer preserved and newer text never marked saved by an old response. |
| A12 | Malicious Markdown/HTML/assets, unknown component or invalid canvas. | Content refused/isolated; declared CSP/egress enforced; no credentials/imported code; UI-only canvas change creates no resource revision. |
| A13 | Binary resource and derived model text; unavailable pinned history. | Original bytes/source revision/conversion lineage retained; explicit unavailable rather than substituted current content. |
| A14 | Enable upstream code mode with native registration; nested calls, invalid/denied operations, limits/cancel/hard crash. | Engine reused. Injected managed operations validate/admit and retain actual evidence; host limits cannot be widened. Native outer task is persisted, not VM state; no automatic mutating replay; partial/unknown effects explicit. |
| A15 | Virtual shell and real sandbox, blocked network/secret access. | Distinct grants and no virtual-to-native fallback. Working scratch stays separate from authorized conditional publication; exposed aliases/shell cannot bypass declared protection. |
| A16 | Multi-resource publication on a provider without a batch transaction. | Honest per-resource receipts and partial/unknown outcome, not all-or-nothing success. No separate writes renamed a transaction. |
| A17 | Upgrade with pending approval, interrupted effect and removed extension. | Backups/migrations and safe unsupported rollback; native configuration compatibility explicit; legacy work receives no invented checkpoints. |
| A18 | Programmatic custom prompt/tools/chat with no definition files. | Native TypeScript registration applied; no sandbox/filesystem/new agent DSL; host styles/slots/headless use retained. |
| A19 | Instrument routed website before first message; switch tabs/subject, disconnect and remove viewer. | Commands hit only their bound instance/view/version. Save has backend evidence; stale/disconnected/cross-tenant calls fail. Existing router/CSP remain; viewer cleanup cannot stop background tasks. |
| A20 | Install custom viewer and chat/editor wrappers using the actual source registry. | Valid item/dependency schemas and real install into disposable app; host styling replaceable; no runtime generated imports or unwanted global reset. |
| A21 | Direct working-file editing, virtual Git status/log/diff, granted Git mutation and durable reopen where promised. | isomorphic-git/just-bash/native facade share one view; no native-process fallback. `.git` grants hold. Working commit differs from publication. Native interface mapping, byte/error semantics and promised metadata recovery tested. |
| A22 | Remove/deny exec while using files/Git/domain/page/viewer and optional code mode. | Independent workflows remain usable with no dummy shell or hidden fallback. Swapping execution changes no unrelated tool semantics. |
| A23 | Remote coding provisions one acquired workspace, builds/tests, disconnects/restarts/cancels/expires. | Same-instance native FileSystem/Shell mapping, stable reattachment or explicit loss, bounded output and separate grants. Cancel timeout is not termination; no host fallback/new empty instance disguised as recovery. Actual conditional publication remains distinct. |
| A24 | Native foreground delegation plus dynamic background steering/follow-up/stop and restart. | Native ownership/graphs preserved beyond predeclared business children. Ordinary cancel versus stop-all is explicit; child grants narrow; no repeated stop on newer work or unnecessary publication through another main-model call. |
| A25 | Render the same fixed experience in its app and embedded in a host. | Same descriptor/kind/version/bindings and structure, no record values in the descriptor. |
| A26 | Compose a layout with unknown kind, invalid props, unnamed action or invisible cell. | Snapshots only render; invalid/invisible elements refuse or become unavailable. Final validated under installed schemas. |
| A27 | Sentinel values in props/state/binding paths/action parameters; compose through fake/local/jev. | No sentinel reaches evaluator or kept descriptor; values resolve per authorized viewer; another viewer without access sees unavailable. |
| A28 | Keep a generated layout, edit it elsewhere, stale keep again, regenerate. | Conditional revision/receipt, stale conflict, regenerated draft cannot overwrite kept content. |
| A29 | Regenerate region by request/visible phase change and failing evaluator, then pin. | Only allowed bounded subtree changes, fixed parts preserved; visible phase update is offered not silently applied; default retained on failure; pin is conditional. |
| A30 | Mixed-app cells, durable action on each, revoke access between render/click, and a local action. | Actions reach their host-assigned app through current authorization/receipt; no parameter redirect; local action makes no backend mutation. |
| A31 | Each evaluator, denied local budget and mid-stream cancellation. | Same validity/authority rules; denied strict composition sends no corresponding provider request; default retained and latency/quality scoped separately. |
| A32 | Fictional morning email/calendar tasks and composed todo, then send/snooze/slot/tick/assistant action. | Only metadata reaches composer. Owning-app actions enforce permission/receipts. Scheduled/on-open work belongs to host/native execution; layout composition adds no scheduler. |

## Additional Pi/complement and Hub M1 journeys

| ID | Trigger | Evidence at the authority |
| --- | --- | --- |
| A33 | Borrow Harness with existing work, attach/detach; separately use owned setup. | No second open or closing/resetting/aborting/reconfiguring unrelated work. Same native handle remains usable. Extend ownership to shared workspace/observer handles; setup releases only its acquisitions. |
| A34 | Plain Pi, then independent install/remove of questions, validation/delivery and optional code mode. | Public native registration/state only; no mandatory workflow or separate coordinator. Unrelated features unchanged; deliberate native replacement/overrides remain usable and accidental Boring collisions require explicit resolution. |
| A35 | Read A, derive work, change source to B, refresh. | Old attempt/evidence/proposal retained; new attempt cannot relabel stale work. Content/listing/search/absence guards hold, including matching newly added files. |
| A36 | Verifier attempts protected source/test mutation, including edit-and-restore through native commands. | Protection holds throughout execution, outputs separate; modified/scratch run cannot pass original candidate. Actual tree/template/environment evidence, no publication grant. |
| A37 | Builder asks, hub/runtime both restart, expert answers; duplicate and cross-task/scope/version/expired replay. | Original native question resumes once; authenticated delegation/responder provenance rather than claimed person ID. Answer is not product approval. |
| A38 | Replacement streams over previous valid output; pending publication/failed save/stale preview and cancellation uncertainty. | Progress, result, proposal, publication, business acceptance and observed execution remain distinct. Retain last valid output and last-known status with freshness; no invented termination. |
| A39 | Qualify Hub M1/1 against exact library/hub/provider/spec revisions. | H01–H08 plus consumer H09 and [host invariant specializations](../compatibility/HUB-M1.md#hub-invariant-specializations). Native dynamic graphs/stop semantics preserved; approval/provider/refresh/privacy contradictions resolved and tested by the consumer. |

## Current consumer migration

A39/H01–H09 retain the historical revision-5 contract; in particular the old H09 release scenario is not reassigned to the current hub. [The owner map](../compatibility/HUB-M1.md#current-consumer-ownership) governs new work. A48 is additive and has no inherited pass. The [fictional companion fixture](../../examples/current-hub/README.md) supplies partial invocation/privacy/recovery evidence; the full journey remains unqualified.

| ID | Trigger | Evidence at the authority |
| --- | --- | --- |
| A48 | Qualify current hub revision-6 H10 with two app fixtures, actual authorized invocation, file app and fixed cross-app view, companion and change-request handoff. | Pinned versions; correct actor/scope; idempotency; native/task/receipt truth; no unauthorized or prohibited payload retained in transcript/logs/caches; mid-stream revocation, denied reference and wrong target replay. No hub-owned builder, merge or deployment and no relabelled A39 pass. |

S0 is part of existing A01/A06/A33: one native tool and one real transactional document provider with stale-write and hard-kill/lost-ack evidence, no browser. S1 adds the real headless controller/flush in A11. A47 grows from those pieces; it is not the prerequisite for their implementation. A partial scenario does not discharge all assertions in a root proof.

## Viewer, filesystem and chat port journeys

Extend these existing IDs with composition cases, not another registry or framework. [LEGACY-UI.md](../compatibility/LEGACY-UI.md) retains the v2/v3 behavior ledger and pending dispositions. Fixtures must exercise the implementation under test rather than reimplement it with a surrogate mock.

| ID | Trigger | Evidence at the authority |
| --- | --- | --- |
| A40 | Native TypeScript consumer with existing custom tools/configuration and no definition files/mounts/exec; run browser-absent background work, then attach resources/chat/viewer. | Public Pi APIs typecheck and execute. No implicit feature selection or second engine. Agent-only, resource/viewer-only and combined use work; adding/removing an unrelated capability preserves native handles/settings/work and direct APIs. |
| A41 | Readonly reference directory and writable documents; change catalog, scope, path policy/history and provider. Separately attach a coherent coding shell. | Supported/granted/available/qualified fields distinct; missing discovery cannot invent access. Scope/view caches, binary/confinement/external-writer behavior and shared watcher cleanup tested. Native file/shell views share one acquisition; wrong namespace/incarnation pairing and shell/alias bypass fail. Provider substitution meets required semantics or explicitly refuses. |
| A42 | Human and native tool use Markdown/canvas; inspect dirty buffer, propose/apply, race typing/save, switch/close viewer and edit saved resource headlessly. | Shared semantics/actual receipts. Saved revision versus local version explicit. No-init-write and exact acknowledgement; dirty/stale conflicts preserved. Closed viewer disables only presentation operations, not resource tools or native background work. Proposal acceptance is not product approval. |
| A43 | Register consumer task-list viewer with schema/controller/renderer/operations; viewer-only/native/headless cases; add second viewer/provider then remove or fail one. | No core switch, second plugin/FS engine or agent-to-browser runtime edge. Same authoritative resource, explicit versions/grants. Partial installation rolls back only new attachments, shared references clean up safely, unrelated behavior unchanged. Deliberate native overrides remain available; accidental collisions fail clearly. |
| A44 | Long tool-heavy history, streaming while reading older content, prepend, thread switch, loading/errors, custom cards and quiet/detailed modes. | Real-browser scroll/selection/focus evidence, stable rows/expansion and bounded rendering. Required questions/errors remain visible. Authorized artifacts/typed provenance. Shared viewer observer cleanup never closes native execution or another consumer's subscription. |
| A45 | Keyboard/IME, paste/drop/upload, pre-submit validation, denied/failed/uncertain send, reconnect/switch, native steering/follow-up/stop. | Drafts/attachments/focus retained without scope/target leakage; uncertain request reconciles original identity. Native queue/retry/compaction authoritative. Local wait cancellation and remote stop/termination are distinct; host base URL/auth/model controls remain. |
| A46 | Build standard registry JSON, actually install into disposable app, typecheck/build/restyle chat/editor/custom viewer and drive their agent tools. | Versioned controllers shared, no copied credentials/kernel/server FS in browser, no heavy viewer in plain chat. Human/native behavior and provider substitution survive restyling. Tldraw qualification remains separate; no invented registry endpoint or installer. |
| A47 | Compose native agent + readonly references + writable Markdown + installed chat/editor/custom viewer. Propose/accept/save/reload, then add/remove/swap pieces, two private working views and expert published view. Exercise unopened documents, dirty/readonly/disconnect, partial acquisition and remote/background lifetimes. | Actual accepted revision/receipt; no stale commit or buffer loss. Same-view coherence, intentional private isolation, no global mutable overlay. Independent attachment failure/removal changes no other identity/grant/workspace. Working-file writes are not falsely published receipts. Report all three reference applications with separate library/provider/consumer evidence; this fixture cannot manufacture clinical expert acceptance. |

### Concrete scaffold composition regressions

A40–A47 additionally require isolated packed UI and UI+files consumers without Pi/agent; generic inline/headless/record viewers; separate renderer; custom descriptor and command-target variance checks with a failing mutation control; create-if-absent save selection; explicit publication atomicity and trustworthy partial-result associations; writer-only versus reconcilable publication; host-selected workspace input and optional recovery; exact native factory/watch/tool types. Actual native smoke exercises async observation/backpressure/close and per-conversation cwd/no-environment resolution, without model requests. These bounded checks do not complete the six deferred Boring runtime proofs or qualify host authorization, provider atomicity, cloud lifetime/isolation or browser behavior.

### Additional composition regressions within existing obligations

A40–A47 preserve concrete controller methods through feature registration, allow shell-only native capability without treating it as ExecutionEnv, and require stable external-store snapshots and explicit async owner teardown. A21/A23 check simultaneous different cwd facades over one native namespace; merely testing sequential cwd changes is insufficient. The native-assumption test does not qualify a sandbox provider.

Development tooling proves real package-test execution, a failing-package negative control and continued release refusal despite passing package tests. Clean builds remove obsolete emitted code and cannot erase source or symlinked external paths. These are tooling/import assumptions, never substitutes for the six pending runtime proofs.

### Performance and recovery calibration

Targets below are proposals, not measurements or currently enforced tests. Calibrate against v2 and the new real fixture on a named runner; record fixture, browser, CPU, sample method and baseline before enforcing changes. Model latency is measured separately.

| Area | Initial target or required observation | Existing journey |
| --- | --- | --- |
| Local composer/editor responsiveness | p95 acknowledgement below 100 ms; retain input/focus under streaming | A44/A45 |
| Large history | At most 200 initially mounted groups for 10,000 events; preserve older-history anchor | A10/A44 |
| Wire/assets | No repeated full-log or binary data in token frames; bounded reads/resnapshot and measured peak memory | A10/A13/A23 |
| Imports/fan-out | Plain chat excludes canvas/Git/execution/server code; scope-safe shared listeners; record remote roundtrips | A41/A44/A46 |
| Recovery | Lost provision/command/publication reply, retained request identity, expiry/GC/restore and uncertain stop | A03/A06/A08/A23 |
| Layout | Check partial descriptors before display; preserve focused and dirty controller instances; sentinels in guidance/errors/IDs too | A26/A27/A29 |
| Drafts | Opt-in recovery, new revision conflict, logout/revocation and late save cannot delete newer draft | A11/A42/A45/A47 |
| Compatibility | Actual registry install/skew and denied remote projection with permitted local native behavior intact | A17/A19/A46/A48 |

Reference-provider tests use one real transaction for resource plus receipt; test inside-transaction rollback and post-commit/pre-ack recovery, never assume an atomic guarantee from a callback. Git CAS/trailer/retention and durable overlay guarantees require separate fault evidence. A metadata declaration or wiring-time comparison cannot certify them. Runtime/core/consumer release obligations remain unchanged and pending where not actually executed.

## Redaction consumer journeys

Use a disposable local instance with invented fixtures, fake models and transcription unless a separate authorized real-model evaluation is requested. Never use production, patient/corpus/credential data or the person's browser as the test bed.

1. Attach beside existing Cloudflare/hub/dev auth; preserve cabinet-wide visibility and requester attribution. Keep the readonly clinical assistant free of required mounts/exec.
2. Upload fictional HTML/text-layer PDF; preserve raw bytes and converted model text separately with lineage. Scans stay explicitly unreadable. Preparation never leaks into today's notes.
3. Type/dictate, then immediately draft A/B/C. The successfully flushed snapshot is the input. Dictation follows its captured consultation/cursor; failed transcription retains retry capability.
4. Run A/B/C independently with one failure/repair. Race rerun, old completion and human correction. Siblings merge correctly and proposals never overwrite corrections implicitly.
5. Kill after child completion and before block/letter delivery; restart reconciles app/export outcomes without stuck progress or duplicate letters/usage.
6. Ask consultation questions, switch/reload/edit input and ask again. Fresh host context plus native tool-rich history; thread/admission/delivery bindings survive crashes.
7. Open local/HAS/PubMed sources and run calculations through normal tools; separately qualify code mode. Only actual returned/opened evidence counts; fake UI does not prove live tools.
8. Change model/effort between submissions, restart admitted work. New tasks use new settings; a selected reproducible workflow honors its captured configuration via public APIs. French errors/repairs retained.
9. Consultation-addressed hub requests use scoped per-initiator keys. Identical request reuses target, changed body conflicts; manifest/read access never widens clinical data access.
10. Preserve semantic clinical components, corrections, copy actions, docked/floating chat and notes editor. Portable viewers adapt rather than force generic Markdown/chat or a canvas.
11. Render fictional preparation as fixed header/synthesis/notes/actions/schedule plus generated clinical-card region. Only enumerated metadata enters layout composition; corrections and notes stay untouched. Local evaluator default, external processing only under explicit host policy. See [REDACTION.md](../stress-tests/REDACTION.md#preparation-page-as-the-first-experience-consumer).

Read stored revisions/receipts after reload/restart. Use existing consumer controls/feature maps plus new fault windows; old tests passing does not prove these new windows. Native environment reuse, mature UI parity, provider conformance and hub business acceptance each need their own honest evidence within this existing plan.
