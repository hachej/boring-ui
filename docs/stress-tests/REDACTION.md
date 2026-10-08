# Stress test: current redaction application

Historical verdict: **the v4 direction fits, but a runtime swap alone does not.** At this review's baseline, no v4 runtime had been implemented. The findings below retain that baseline; the [current feature map](../implementation/FEATURES.md#fictional-redaction-corrections-and-adoption) records subsequent fictional runtime evidence. Full consumer compatibility remains unqualified.

Scope: source review by three independent backend/UI/adversarial reviewers, full current-app gate, and a read-only validator probe. [BASELINE.md](BASELINE.md) records versions, executed commands and limits. Paths below are relative to `boring-clinic-redaction` unless explicitly marked Pi. Citations refer to the audited working tree; the app contains two pre-existing dirty files and was not modified.

## What must survive

- Existing Node/SQLite/files deployment, Cloudflare Access/hub/dev identity, cabinet-wide consultation/thread visibility and separate requester attribution.
- Preparation, three parallel A/B/C writers, typed output validation/repair, model/effort settings and French failures.
- Original HTML/PDF resources, derived model text, explicit unreadable scans and read-only clinical assistant.
- Doctor-owned corrections distinct from generated proposals, edited letters, notes/dictation and rapid structured preparation above notes.
- Existing consultation-addressed hub wire and discovery; no required shell, canvas, agent file mount or clinical code in library packages.

The app is therefore a better acceptance consumer than a generic chat demo. It also does not validate canvas demand: test that independently rather than inventing a clinical canvas workflow.

## Findings and specification changes

### R01 — Required provenance is optional on the installed runtime path — blocker

`agents/preparation/index.mjs:26–40` checks returned calculator percentages and opened URLs only when trace is supplied. `agents/assistant/index.mjs:36–42` similarly gates source markers. The installed Flue path calls `run.validate(reply.text.trim())` without trace (`vendor/boring/agent/src/runtime/flue.ts:171`); its captured helper trace lacks actual return evidence (`:90–91`). The direct runner supplies evidence (`runtime/agent.mjs:89,108`), so its tests do not certify the installed seam.

**Executed probe:** invented unsupported SCORE2 and source-marker text is accepted without trace and refused with `trace: []`. This confirms validator behavior, not a production incident or a model's actual answer. Reproduce with `node scripts/probe-redaction.mjs ../boring-clinic-redaction`.

**v4 change:** this consumer installs optional native validation/repair and delivery features. Their producing/validating/repairing/ready application-result states use native tasks/documents, not a replacement Pi generation loop or throwing observational hook. Required missing evidence fails closed. Persist actual nested tool evidence independently of code-mode output. Classify full-section search returns as opened content when appropriate (`runtime/knowledge.mjs:237–250`), not simply by an action called search.

### R02 — Completed execution can lose application delivery — blocker

`server/work.mjs:56–61` applies results in an in-memory `wait` callback; blocks, preparation and answers depend on it (`:92–98,119–122,151–154`). A crash after producer completion but before application publication has no durable delivery obligation. Restart marks app work interrupted (`server/main.mjs:25`, `server/domain.mjs:316–320`), rather than recovering a completed result.

**v4 change:** atomically admit producer and delivery obligation before execution. A durable delivery task waits for validated output, applies it through idempotent conditional host operations and reconciles provider receipts. Model completion and application publication are separate visible states. Prove this atomic binding with actual Pi primitives.

### R03 — Parallel completion needs per-subject generation/edit guards — blocker

`server/domain.mjs:290–302` correctly transactionally merges the current block JSON, preserving independent A/B/C completions. But `:271–276` uses timestamps as generation identity; same-millisecond reruns can share one. Manual edits (`:251–266`) do not advance the generated proposal revision. B corrections use array indices, which can refer to a different regenerated item.

**v4 change:** opaque per-block generation IDs, independent human-edit revisions and stable item identities. Do not replace this with a single consultation-wide CAS that rejects sibling completions. A new proposal remains distinct from the effective correction until deliberate adoption; stale proposals may remain inspectable without publication authority.

### R04 — Letters and records do not share a commit boundary — blocker

`server/work.mjs:94–95` commits C block data and then blindly writes letter files. Failure/crash can split the state or overwrite a concurrent human letter edit. `server/workspace.mjs:34–47` has no operation-ID receipt or durable mutation reconciliation.

**v4 change:** choose a transactional authority for bytes/receipts, or a durable cross-store publication manifest with individually receipted partial results. Capture original letter revisions. Do not advertise atomic all-or-nothing DB-plus-directory publication.

### R05 — Flush is not an acknowledged input barrier — high

`experience/src/shared/FileEditor.tsx:51–64` catches save failures; `:76` resolves flush with latest local text anyway. A conflict reloads and discards the dirty buffer (`:58`); pagehide marks text saved without an acknowledgement (`:96–101`). `experience/src/redaction/App.tsx:143–150` awaits flush and can therefore draft after unsuccessful persistence.

**v4 change:** flush returns acknowledgement for the exact selected revision/snapshot or fails. Generation admission refuses unconfirmed input. Preserve local conflicts; unmount/keepalive saves are best-effort until acknowledged. Test edits arriving while another save is pending.

### R06 — Late dictation can apply to a newly selected consultation — high

`experience/src/redaction/Dictate.tsx:29–36` posts with a captured consultation ID, then invokes a callback. `experience/src/redaction/App.tsx:288` uses the current notes ref; its notes editor is consultation-keyed at `:295`, while Dictate is not. This is a source-identified race; no browser repro was performed.

**v4 change:** bind all async editing/presentation callbacks to subject/resource and page-instance epoch. A completion for A cannot insert into B after a switch. Microphone/transcription lifecycle remains host-owned; resnapshot should not remount dirty editors or lose selection.

### R07 — Shared cabinet scope is not the initiating person — compatibility blocker

`server/host.mjs:3–16` returns CABINET for every authenticated person and grants no mounts. `server/hub.mjs:67–74`/`consultation-wire.mjs:76–81` separately preserve initiator/acting identity. Settings permissions remain role-sensitive (`server/app.mjs:117–118`).

**v4 change:** scope ownership is host-defined, including explicit shared scopes; initiator/principal/installation provenance is durable on every entry point. Never partition existing cabinet history by email, widen access from a hub capability claim, or grant file/coding access because the application stores files.

### R08 — Admission retries and initial thread creation have crash/race gaps — high

`server/consultation-wire.mjs:36–52` reserves an empty request row, starts work, then records its target. A crash can leave indefinite 409 or work without a bound target; an exception deletes the reservation even if work started. The digest uses order-sensitive JSON.stringify. `server/work.mjs:146–150` can create two threads when concurrent first questions both observe no binding. Chat exports (`server/domain.mjs:330–331`) have no stable delivery uniqueness key.

**v4 change:** atomic canonical request/target binding with interrupted-admission reconciliation; unique consultation-thread binding; ordered turns within that thread without serializing independent structured children; idempotent message projections keyed by durable identity.

### R09 — Model admission and settings need proven upstream seams — blocker

Pi ordinary hook exceptions are report-and-continue (`Pi packages/durable/src/harness/scheduler.ts:1059–1069`); safe tool recovery bypasses admission hooks. Pi's Codex provider can retry internally (`Pi packages/ai/src/api/openai-codex-responses.ts:388–424`). Generation dispatch does not explicitly pass Boring task/attempt identity (`Pi packages/durable/src/harness/generation.ts:399`). Pi settings are mutable/read-at-use (`Pi packages/durable/src/harness/types.ts:390–400`).

**v4 change:** a feasibility spike must demonstrate fail-closed admission of actual transport attempts with durable identity; disable/intercept opaque retries. Persist admitted model/effort/definition/date bindings consumed by retries, repairs and compaction. Clinic currently resolves settings per child run (`server/main.mjs:33–37`, installed `runtime/runtime.ts:98–102`); choose whole-job vs per-child consistency explicitly.

### R10 — Legacy resources are not strong v4 providers — high

`server/workspace.mjs:19,33–45` uses floored mtimes, optional CAS, asynchronous timestamp adjustment after returning, and lexical path validation rather than symlink confinement (`:12–17`). `server/app.mjs:157–161` allows omitted expected revision. Binary originals/sidecars are genuinely stored (`server/domain.mjs:179–205`), despite empty agent mounts; context derivation drops source revision (`:241–246`).

**v4 change:** qualify/replace the provider; support source bytes/MIME/revisions and derived-text lineage with extraction status/version. Preserve explicit unreadable scans and app-owned conversion. Test same-millisecond and cross-process writes, traversal/symlinks and unauthorized assets. Do not certify legacy mtime/file writes by wrapping their method names.

### R11 — Reporting and UI coverage can overstate evidence — medium/high

`server/work.mjs:35–53` stores usage/meta in memory, defaults absent usage to zero and exports a run row without a stable task ID. Current E2E covers ordinary flows but not all correction-after-rerun, late dictation, failed-flush or crash-delivery windows; source-provenance tests exercise the direct runner.

**v4 change:** durable retryable usage/reporting projection with unknown usage distinct from zero; authorized evidence descriptors and source labels; new fault-window tests. Keep the custom clinical UI rather than flattening it into generic Markdown/chat. Preparation remains separate from today's notes and its six-part clinical hierarchy remains host-owned (`docs/product/CLINICAL_CONTEXT.md:9–39`).

## Preparation page as the first experience consumer

Today the brief is one Markdown answer above the notes, foldable once read and never part of them (`experience/src/redaction/Preparation.tsx:12–18`). The page recognizes six fixed headings and nests disclosures by heading level (`experience/src/redaction/PreparationBrief.tsx:22,63–64`); the agent's exact format defines those sections (`agents/preparation/agent.md:40–71`). An unexpected heading falls back to plain Markdown. Layout, the notes editor (`experience/src/redaction/App.tsx:295`) and dictation are clinic code.

**Target, specified in [EXPERIENCE.md](../architecture/EXPERIENCE.md).** The preparation page becomes a fixed experience of the clinic: header, synthesis, notes, action bar and schedule stay fixed clinic components. One generated region holds the clinical cards, composed from the preparation task's typed cell output. Each card is a clinic-registered kind (a problem, a risk factor, a follow-up, a question for today) with stable item identity and enumerated metadata the host computes from the validated output: `acute`, `decision-today`, `above-target`, `up-to-date`. The evaluator sees "problem card, acute, decision today"; never a condition, value, date or name. `local` is the default evaluator; `jev` needs an explicit processing policy for composition metadata.

What this needs first, all already blockers above: the structured preparation output validated before delivery (R01, R02), per-item identities and correction revisions so regeneration cannot replace a doctor's correction (R03), and flush barriers so the notes buffer is never part of composition or lost by it (R05). Regenerating the region by phase (a new preparation) or by request must leave the notes, header, action bar and schedule untouched (EXPERIENCE-7). This is a specification of the consumer, not a migration: the clinic is not changed by this work, and its existing renderer stays until a separate migration branch replaces it.

## Adapter map

| Current boundary | v4 treatment |
| --- | --- |
| `server/host.mjs`, auth/hub wiring | Host context, shared scope, initiator and capability admission; preserve existing authorization. |
| `jobs/redaction`, `jobs/brief`, agent definitions | Named versioned tasks/configurations and parallel Pi children; pure planning remains app code. |
| `server/work.mjs` | Snapshot/admission + durable delivery adapter; no callback-owned publication scheduler. |
| `consultation-wire.mjs` | Explicit compatibility mapping for named jobs/conversation, ID/digest bindings and hub discovery. |
| `consultation_threads`, `chat_messages`, `agent_runs` | Host subject binding and idempotent projections, not duplicate runtime truth. |
| `workspace.mjs`, domain mutations | Strong resource/record operation providers or explicit weaker legacy guarantees. |
| Clinic React components | Keep layout, correction rules, preparation sections, dictation and copy controls; inject portable adapters where useful. |
| v3 history | Read-only legacy provenance/ID map; fresh submission for interrupted legacy work. |

Generic `/agent` submission without consultation currently differs from consultation-addressed work (`consultation-wire.mjs:10`, `server/app.mjs:88–94`). Compatibility must preserve or deliberately restrict that distinction, not silently publish generic outputs into a clinical record.

## Required implementation decisions

1. Prove Pi task+document admission, structured validation/delivery wrapper, and provider-attempt correlation before committing to API promises.
2. Choose transactional resource/record providers and cross-store publication semantics; define revocation fencing.
3. Fix generation/subject/edit identities, initial thread binding and request reconciliation in the host adapter.
4. Preserve scope/initiator separation, fresh context plus pinned inputs/configuration, and output/tool evidence.
5. Define clinical migration adapter and backup/cutover procedure without editing production or patient data.

[ACCEPTANCE.md](../acceptance/ACCEPTANCE.md) turns these findings into required journeys. This review identifies risk and design corrections; it does not certify those corrections as implemented.
