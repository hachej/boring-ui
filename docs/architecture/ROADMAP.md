# Delivery roadmap

Status: adopted plan revision, 2026-10-02, against scaffold baseline
`04888ca6787b5f8bfa6350cc56b3174c3e756071`. Scaffold/build/native-assumption tests
are not implemented provider, browser or application guarantees. This revision changes delivery
sequencing and acceptance obligations; it implements no runtime. Existing
[BORING-PI-1..6](../../INVARIANTS.md), P01–P14 and A01–A47 are retained, with an
explicit consumer-owner migration and a new current-hub journey A48, rather than renaming old evidence.

The product is independently composable application capabilities around native Pi. Preserve direct
native tools, configuration, environments and execution. Prefer the existing native or host
operation over an equivalent Boring wrapper. Add a reusable interface only when an executable
consumer demonstrates its missing meaning.

Implementation progress is recorded in [PARTIAL.md](../implementation/PARTIAL.md). S0/S1 and native question/document-delivery increments have tests; the full roadmap and global release obligations remain incomplete.

## 1. Rebaseline consumer ownership before dispatch

The reviewed hub SPEC is revision 6 at `3c5b9adfc08525594dc071f824813a8708d0e3f5`:
registry/identity, capability invocation, file apps, companion and cross-app UI composition.
Factory discovery/triage/claims/build/review/release belong to `boring-factory` and app
repositories; skills belong to `boring-stack`. Pin the Factory/App contract revisions when their
integration work begins. An ownership declaration is not proof that every consumer implements it.

[Consumer compatibility](../compatibility/HUB-M1.md) preserves Hub M1/1 as the historical
revision-5 qualification contract. Its H01–H09 definitions and evidence provenance are not silently
reassigned. The old Factory-style H09 remains a Factory/app scenario; H10/A48 describes the new
hub control/composition qualification. Remote work and release machinery are not current hub prerequisites.

| Composition | Owner-specific acceptance | Not a prerequisite |
| --- | --- | --- |
| Hub control/composition | Verified actor/installation; exposed capability invocation; truthful task/receipt reference; isolated file app; fixed multi-app view; safe companion and change-request handoff | Remote builder, code review, merge or deployment machinery |
| Factory/remote coding | One qualified workspace; native coding tools; protected verifier inputs where claimed; safe publication; Factory-owned workflow decisions | Running the hub or using a Boring UI shell |
| Embedded application | Existing host services plus optional native question/validation/delivery; app-owned input/result/privacy and acceptance | Browser, file store, shell, public HTTP service or Hub Job |

Record which earlier consumer contradictions are fixed, still present or no longer applicable.
Business obligations stay separate from Pi's native dynamic descendants. This repository does not
modify consumer implementations or certify them by agreeing on ownership.

## 2. Delivery by executable vertical slices

A full-scope target is not a requirement to build everything before anything is useful. Keep
advanced features in scope while making each installed capability independently tested and
honestly usable. Do not mark the full product, Factory or hub qualified from a smaller slice.

Start with **S0**, a thin browser-free composition: borrowed native Harness, one native tool,
and a real conditional document provider with operation lookup. Use the host's transactional
provider, or the SQLite reference fixture described below. Prove stale revision refusal and a
hard kill after the atomic resource/receipt commit but before native acknowledgement. S0 exercises
parts of A01/A06/A33; it does not discharge an entire root law whose other assertions remain pending.
**S1** adds one headless Markdown controller and the exact-flush race/failure cases in A11. A47
grows from these slices into full integration, not a prerequisite before any code can run.

| Slice | Actual deliverable | Exit evidence |
| --- | --- | --- |
| 0 — reconcile and prove assumptions | Current consumer owners; scoped public API/storage/transport feasibility; explicit trust and payload-residency choices; S0 | Pinned sources and executable public-API/kill tests; unresolved strict guarantees named in the seam register. No new generic engine, registry or placeholder adapter. |
| 1 — useful editor/assistant | S1; port the v3 Markdown controller and v2 interaction behavior; one concrete document provider; one native agent tool; basic installed chat/editor | Human edit, agent proposal, exact adoption and acknowledged revision survive reload. Dirty, stale, denied, new-file and lost-response paths are driven. |
| 2 — browser-free background work | Host-triggered native task; install validation, question and delivery only where needed | Hard kills around producer completion/provider commit; one accepted outcome recovered; no browser/files required; human corrections retained. |
| 3 — remote coding | One actual provider on native FileSystem/Shell/ExecutionEnv; coherent acquired workspace; controlled exposure and reviewed publication | Real installs/build/tests; lost acquisition reply, reattach/expiry, uncertain process outcome, protected inputs and publication. A fake vendor does not qualify a real one. |
| 4 — current hub composition | Revision-6 identity/capability adapter; file apps; fixed/derived cells; companion with explicit content policy | H10/A48: two app fixtures; actor provenance; reauthorization; denied cross-app reference; no prohibited transcript/log retention; source-owned operations and change-request handoff. |
| 5 — complete presentation and optional intelligence | Mature chat port; custom viewer; tldraw; fixed/derived experiences; optional generated regions/code mode; full source recipes | Existing A14/A22/A25–A32/A40–A47 and legacy ledger; measured privacy/performance; model usefulness separate from plumbing. |
| 6 — compatibility, packaging and rollout | Native/provider/recipe compatibility, migrations, backup/restore, diagnostics and qualified scope | Built artifacts and installed consumers; restore-and-reconcile drill; every claimed global proof. Full release still fails on unresolved required obligations. |

Order follows actual dependencies, not package names. UI can progress against the real provider
while background and remote work develop independently. Give each shared contract one integrating
owner; use isolated worktrees for bounded implementations.

Fake models and controlled external services isolate cost/nondeterminism. They must not replace
the resource/controller/transport being qualified. Extend existing journeys and registries; do
not create another framework or renumber earlier failures out of the report. The
[seam register](UPSTREAM-EXAMPLES.md#seam-qualification-register) makes feasibility finite without
claiming that a small successful probe establishes every library guarantee.

## 3. Keep native in-process APIs; define the remote boundary explicitly

Retain exact native tools, environment factory and ConversationWatch for trusted in-process use.
The native watch is not itself a browser protocol: callbacks, Context and Error objects have
process-local semantics. Do not make a browser fabricate a server Context or interpret a closed
connection as a stopped task.

Evaluate public Pi client/protocol/server components before equivalent code. Reuse them when they
fit; otherwise add one small authenticated host adapter. Transport serializable, permitted
projections/commands with native identities. Connection freshness and authorization failure are
presentation state, not a second execution lifecycle. Preserve backpressure/resnapshot without
exposing arbitrary native documents or private change operations. The current native ChatSource
interface is not a claim that this remote adapter exists.

Authorize subscribe, initial snapshot, subsequent delivery, assets and effect calls. Permission
changes end or refresh affected streams under the declared revocation policy. Scope/view/source
partition caches and deduplication; clear restricted presentation on principal changes. Do not
retain unbounded history or replay effects during reconnect. Plant private values in native docs
and tool returns: filtering after sending them to the browser is too late.

Native handles and tool schemas are not sandboxes. Trusted hosts retain native access; protected
resources are fenced at the actual provider. Qualify privileged developer and restricted expert
views independently. The owning remote contract is [CONTRACTS.md](../contracts/CONTRACTS.md#remote-projections-and-connection-state).

## 4. Prove one real resource authority before generalizing providers

Working I/O and authoritative documents remain distinct. The first strong reference provider uses
an existing transactional host database; where none exists, use a small SQLite-backed fixture.
Keep fixture bytes, revisions and operation outcomes in one transaction. This is an optional
provider for managed documents, not replacement of an application's database.

Directory/sandbox access remains working access unless it independently proves stronger
publication. Rename plus an unrelated receipt insert is not an atomic commit. Useful weaker and
read-only providers remain available with honest declarations. Git publication earns its own
conditional-ref and replay guarantees; it cannot inherit database-provider test results.

Initially support one commit authority and nonempty independent changes with expected
revision/absence and stable operation identity. Refuse duplicate/overlapping targets, unsupported
cross-authority atomic requests and ambiguous per-change dependencies before effects. Expand only
for a concrete consumer. No distributed transaction or generic operation-expression language.

Capture mutable bytes, normalize allowed identities, validate input, resolve authority and compute
a versioned canonical digest at the trusted boundary. Same key plus accepted payload returns the
recorded outcome; changed payload conflicts. Read dependencies and target conditions are checked
at the commit authority. Listing/search/absence tracking is additional qualification, not an
assumed property of basic file types. Wiring-time checks catch known incompatibility early but do
not replace call/commit-time authorization. [FILES-GIT-EXEC.md](FILES-GIT-EXEC.md#reference-publication-and-recovery) owns these rules.

## 5. Reconcile uncertain effects and align retention with recovery

Use existing native task plus provider-operation identity. Record admitted key and resolvable
input before the effect, then bind its actual provider result. Use provider-native idempotency,
lookup or tagged-resource discovery; do not add a scheduler or generic retry daemon.

Name the hard cases: provisioning succeeded but its reply/binding was lost; command started but
acknowledgement was lost; publication committed but reply was lost; cancellation was requested
but termination was not observed. Reattach by a known workspace ID cannot solve acquisition whose
ID was never recorded. Unsupported reconciliation yields unknown/manual intervention, not blind
allocation, execution or publication again.

Reobserving, retrying an idempotent request, re-executing code and compensating are different.
A build/test command can have external effects. Grants and their recovery semantics must cover
those effects. Receipt/snapshot retention must cover the replay window. Garbage collection cannot
turn an old duplicate into a new effect: retain appropriate tombstones or expire/reject that key
namespace. Preserve inputs for pending tasks; back up document and operation state coherently.

Suspend/snapshot/dispose cloud work only under the provider's demonstrated lifecycle, especially
while awaiting humans. A local private Git ref is not crash-durable without durable underlying
objects/refs and a pinned checkpoint protocol. There is no mandatory commit of every tool call or
full-tree checkpoint for every build. Qualification measures overhead and the exact loss window.

## 6. Make expert change review the first visible product feature

Use a proposal backed by existing host/resource storage: exact before/after, base revision,
change digest, author/source and appropriate evidence. Tool, editor diff and review card reference
one proposal, not separate truths. Support inspect/accept/reject and rebase-as-new-proposal where
safe. The accepted change is the reviewed change; regeneration cannot silently replace or expand
an open proposal. Undo is a new conditional operation against current state, not erased audit or
blind restoration of old bytes.

Port v2 drafts, scroll, selection, focus, error and tool-card behavior and v3 headless edit/proposal
semantics. Never port continued-typing-as-overwrite-consent. Quiet mode retains required questions
and actionable failures. Use the [legacy ledger](../compatibility/LEGACY-UI.md), not a fresh minimal-chat demo as a parity claim.

Draft recovery is host-injected and opt-in, scoped by principal/resource/view/base revision.
Sensitive hosts may disable browser persistence. Restore/discard is explicit and compares the
current revision; recovered text is neither a committed save nor generation input until its
normal save/flush succeeds. Logout/revocation must not expose drafts to the next person. Delete
only the acknowledged draft version; a late save cannot delete newer unsaved work. The owner is
[WEBSITE-INTEGRATION.md](WEBSITE-INTEGRATION.md#change-review-and-draft-recovery).

## 7. Bound bytes, updates and fan-out before adding performance machinery

Measure actual compositions and calibrate on a named runner before enforcing numeric targets.
Initial proposals: local composer/edit acknowledgement p95 below 100 ms; at most 200 initial
message groups in a 10,000-event fixture; no repeated full-log/binary assets in token updates.
These are targets, not observations or model-latency promises. Record bundle/memory baselines and
retain optional-dependency exclusions even before numeric bundle budgets are calibrated.

Use stable snapshots and selectors; update the affected message/viewer rather than every cell.
Coalesce progress without losing authoritative result references. Separate first useful output,
model/tool/persistence/browser time, wire bytes, listener count and remote calls. Bound text/log
reads; use native output spill and existing authenticated asset/HTTP stream/range mechanisms.
Large bytes stay outside chat descriptors and progress replay. Optional batch/range operations
are capabilities, not required extensions of every filesystem.

Multiple viewers share scoped observations; different scopes never share privileged results.
Use host-supported batched reads to avoid per-cell waterfalls. No cache service or new delta
protocol without measurements. Plain chat excludes canvas, Git, execution and server modules.
Budgets and scenarios live in [ACCEPTANCE.md](../acceptance/ACCEPTANCE.md#performance-and-recovery-calibration).

## 8. Keep layout intelligence optional, private and predictable

Ship fixed and deterministic derived layouts first through one validator/renderer. Canvas,
generated regions and upstream code mode stay in full scope, not prerequisites for basic chat,
editing or background work. Inject an evaluator through a neutral public contract and compose
native model access in host code; no UI-to-agent facade dependency or replacement evaluator engine.

Privacy covers every input, not just structured metadata: guidance, descriptions, IDs/URLs,
errors and cached prompts. For an external metadata-only evaluator, derive approved non-sensitive
intent locally or refuse. Raw user text is not an exception, and even enumerated metadata needs
host processing policy. These requirements are owned by [EXPERIENCE.md](EXPERIENCE.md).

Validate partial as well as final snapshots before display. Retain current/default layout until a
candidate is safe. Never move a focused control or remount a dirty editor merely because the
outside JSON is unchanged. Adopt at a safe interaction boundary or explicit acceptance. Layout
cannot invoke mutations, install native code or reveal unauthorized cells. Start with kinds used
by real consumers; evaluate task usefulness, not only schema validity.

## 9. Diagnose existing evidence; do not add another state authority

Provide a read-only authorized diagnostic view/CLI over native task/question/delivery and provider
references. Show binding/epoch, last observation and freshness, candidate/revision, missing
capability and safe next action. Correlate using existing IDs through host telemetry; do not add a
second durable event or transcript database. Not every entity needs every ID.

Keep native outcomes and domain outcomes distinct. Shared display wording can explain denied,
unsupported, stale/conflict, unavailable, expired and unknown. It does not require one giant result
union or override Pi's controls. Reconnect resubscribes; reconcile checks the original operation;
retry is new work only with explicit identity/safety. Generic retry-all is not a repair strategy.

Set payload residency before cross-app companion use. Raw app returns may enter its native
transcript even if Job tables keep only references. Sensitive interpretation should remain in the
data-owning app, or retained companion content requires a separately approved host policy. Inspect
native storage/prompts/logs/exports/caches; do not claim no app-data retention from table design
alone. No private Pi patch is a remedy for an incompatible policy. See the current hub qualification.

## 10. Package useful recipes and keep one source of instructions

Ship small executable host recipes for remote coding, background app work and an assistant/editor
beside an existing app. Prefer native TypeScript over a setup DSL. Worker skills stay in
boring-stack and deployment workflows in boring-factory, not the UI runtime.
Built and proven offline, live run pending an account: [AWS AgentCore recipe](HOST-RECIPE-AWS.md) (Runtime or ECS + Code Interpreter + one EFS folder per user).

Use standard shadcn distribution. For a deliberately public source release, qualify direct GitHub
registry consumption before operating a server. Private distribution uses a supported authenticated
namespace or controlled local fixture. Never make a repository public as a side effect. Pin the
CLI and each item dependency; parent refs do not automatically pin children. Recipes copy
presentation over versioned behavior, not runtime internals or credentials.

Declare supported native/provider/recipe/wire versions, preserve native aliases, and test pinned
versions on every change. Evaluate upgrades separately. Test packed consumers, runtime bundles,
host styles, strict CSP and skewed client/server deployments; unsupported versions fail clearly
without discarding unsaved work. Runtime targets are in [SPEC.md](SPEC.md#runtime-targets); Node is
first, edge execution is unqualified until its storage/ownership/recovery seams are proven.

The spec owns semantics, interfaces record implemented contracts, acceptance owns evidence,
roadmap owns order, and historical reviews retain provenance. Consolidate owner sections rather
than adding another TRACE file/registry or copying every rule into every agent instruction. Task
packets name pinned revision, consumer, public behavior, owned files and tests. Test count and a
public-import check are not coverage or assertion quality.

## Qualification and handoff

Preserve historical acceptance IDs and evidence. H10/A48 adds the current hub journey; H09/A39's
Factory-style history is not relabelled as a pass. Full P01–P14 scope remains, including mature
chat, canvas, experiences, code mode and consumer migration. Reports distinguish source
implemented, integration tested, provider qualified, expert accepted and release authorized.

The overnight packet must be reconciled against this revision and current owners before dispatch.
Do not retain obsolete W00–W13 dependencies or bypass a stale preflight. Parallelize independent
work behind tested contracts. Missing vendor credentials, licenses or strict seams block only
the affected qualification; they do not authorize weaker defaults, fake evidence or removal of
unrelated native capability.

Coordinated owner edits in SPEC, CONTRACTS, HUB-M1, PRODUCT-REQUIREMENTS, EXPERIENCE,
WEBSITE-INTEGRATION, FILES-GIT-EXEC, UPSTREAM-EXAMPLES and ACCEPTANCE accompany this plan revision.
They are requirements, not implemented runtime features. Consumer repositories, current native
interfaces, dependencies, global proof status and release enforcement are unchanged by this update.
