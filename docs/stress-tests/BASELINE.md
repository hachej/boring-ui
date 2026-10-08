# Audit baseline and executed evidence

Date: 2026-10-02. Local Node: 22.22.1. No production, private eval cases, patient records, licensed corpus or credentials were accessed. Redaction source was not changed.

## Versions

| Subject | Baseline |
| --- | --- |
| Redaction app | `8f580bbc8bbc063b1a7f14acabb910af4780f4b3`, local branch `flue-jobs` |
| Vendored Boring | `f95b1e5abbe9670de6292e72dd4d3cdadd62e647` per `vendor/boring/SOURCE.json` |
| Redaction pre-existing dirty files | `AGENTS.md`, `experience/src/redaction/Blocks.tsx`; review/gate used the working tree, not a claim of a clean committed baseline |
| Pi initial audit / current examples | `28eaccb8e87d075562593073282cc0774f2c2e3b` / `0495646a8322ff99ce40ac2f9e15f1f49f56bb11`; no reviewed durable/ai/codemode diff between them |
| Published Pi used for probes | `@earendil-works/pi-durable@1.0.0`, installed in isolated `/tmp/pi-durable-probe.JARpQH` |
| Jev, live probe | TypeSafe System One endpoint, `jev-latest` → `jev-1.13.0`, direct TypeSafe key (not a Gateway key) |
| json-render, for the experience probe | `@json-render/core@0.21.0`, `@json-render/react@0.21.0` (react 19.2.3 peer), `zod@4.6.5`, installed in an isolated scratch directory with install scripts disabled; upstream source `vercel-labs/json-render@fc2a696a50a30cb30c878ab1eb65e102487eea0f` read for line references |
| Other research versions, not installed in v4 | just-bash 3.6.0; isomorphic-git 1.42.6; tldraw SDK version/license not selected yet |

## Redaction current-app gate — executed, passed

Command in the redaction checkout: `node scripts/verify.mjs check`.

```text
ok   lint (1 s)
ok   feature-map contract (0 s)
ok   unit tests (4 s)
ok   typecheck + build (25 s)
ok   end-to-end journeys (31 s)
gate passed
```

The gate used existing fake models, fictional test fixtures and fake transcription. It rebuilt generated UI/test artifacts but left tracked source changes exactly as found. It proves current test coverage, not real-model quality or newly proposed v4 fault windows. No additional interactive browser journey was run: an existing verification instance was already registered, and it was not restarted or driven.

## Validator seam — executed, confirmed

Command in v4: `node scripts/probe-redaction.mjs ../boring-clinic-redaction`.

```text
CONFIRMED: preparation accepts unsupported SCORE2 without trace; refuses it with empty trace.
CONFIRMED: assistant accepts unsupported source marker without trace; refuses it with empty trace.
Scope: validator calls only. Installed Flue omits trace by source inspection; no live answer or patient data tested.
```

This probe imports validators and uses invented strings; it makes no model/tool/network request. Compare installed `vendor/boring/agent/src/runtime/flue.ts:171` to direct-runner trace delivery. The exception contrast is directly observed; the production-path consequence is established by source inspection, not a production incident report.

## Upstream examples — executed, six passed

Copied selected pinned source examples only into the isolated `/tmp` probe. Replaced source-relative durable/env/tools/storage imports with published package exports. Otherwise retained example logic. Ran each with `OPENAI_API_KEY` and `CODEX_AUTH_FILE` unset, Node type stripping and a 45-second outer deadline. All exit codes were zero.

| Example | Observed |
| --- | --- |
| 22 foreground | Child answered; parent received/displayed answer. |
| 23 background | Spawn/send/stop/status and reported answer after Harness close/reopen. |
| 24 child tasks | Failed child/cancel ownership behavior and children complete after reopen. |
| 26 coding agent | Bash cwd moved from disposable workspace to its app subdirectory. |
| 29 sandbox per conversation | Alice/Bob notes landed in separate disposable directories. |
| 31 reload and restart | Running call used v1, next v2; missing restart install exposed no tool; reinstall exposed version tool. |

These are faux-model demos; close/reopen is not a hard process-kill test. Directory-backed NodeExecutionEnv is not confinement, and fake external charges are not transaction proofs. Reuse the native patterns as mapped in [UPSTREAM-EXAMPLES.md](../architecture/UPSTREAM-EXAMPLES.md), not their demo authority assumptions.

## Virtual filesystem + Git — executed, passed

Installed just-bash 3.6.0 and isomorphic-git 1.42.6 only into `/tmp/boring-v4-vfs-git.RWvjnf`, with install scripts disabled. Command in v4: `node scripts/probe-vfs-git.mjs /tmp/boring-v4-vfs-git.RWvjnf`.

```text
PASS: VFS Git init/add/commit/status/log/branch/checkout; binary bytes preserved.
PASS: virtual Bash and Git share bytes; file snapshot reconstruction retains history; native process calls=0.
Scope: isolated in-memory feasibility, not durable provider/CAS/receipt/recovery or remote-network certification.
```

The probe supplies a small Node-compatible adapter over `InMemoryFs`, denies child-process entry points and fetch, and exercises only local Git. Snapshot reconstruction is a new in-memory instance, not a durable storage/process crash test. This validates feasibility of exec-independent virtual Git/Bash; the scratch adapter is not a Boring authorized/receipted provider.

## json-render composition — executed, passed

Command in v4: `node scripts/probe-json-render.mjs <isolated install>`. Deterministic in-process evaluator, invented sentinel strings, `fetch` denied; no model or Gateway call.

```text
PASS: @json-render/core@0.21.0, @json-render/react@0.21.0, zod@4.6.5; 2 evaluator request(s) carried descriptions only: no literal prop, state value, binding path or action parameter.
PASS: the composed spec embeds initialState: a spec carrying values must be bound after composition, not composed with them.
PASS: catalog.validate refuses an unknown type but accepts props that violate the strict component schema; a host must validate props per element.
PASS: unknown candidate types, invalid candidate props, unbound actions and evaluator choices outside the offered criteria are refused.
Scope: one pinned package build with an in-process evaluator; not Jev quality, Gateway transport, latency, a Boring catalog or a renderer.
```

These observations shape [EXPERIENCE.md](../architecture/EXPERIENCE.md): stripping is still required because returned specs embed `initialState`, and per-element props validation is the host's. Jev was later run live; see the next section.

## Jev live composition (A31, real-model level) — executed, passed

Command in v4: `node scripts/probe-jev-live.mjs <isolated install> .cache/evidence/jev-live 3`, with `TYPESAFE_API_KEY` read from the local Vault into the process environment and never printed. Endpoint `https://api.typesafe.ai/v1/systemone`, model `jev-latest`, which resolved to `jev-1.13.0`. Same isolated install as the composition probe. Network was limited to that endpoint, and every request body was captured before it left. Candidates were invented and metadata-only: each full cell (bindings, invented values and an action parameter, all carrying sentinels) was stripped to `{ id, description, root?, maxUses?, element: { type, props: { cell } } }`. After composition the markers were rebound to the full cells, bindings resolved against an invented state, and the result validated by `catalog.validate` plus each element's strict props schema.

**Adapter.** TypeSafe takes json-render's `{ state, questions }` body plus `model`. It answers `answers[q] = { type: "choice", choice, confidence, probabilities }` and `usage.input_tokens`, so a direct adapter fits the evaluator interface in [CONTRACTS.md](../contracts/CONTRACTS.md#experiences-cells-and-composition) as written. `experimental_createEvaluator` in 0.21.0 has the Gateway URL fixed; its `fetch` option can redirect to the TypeSafe endpoint with the body plus `model`, and that path also completed (462 ms, `finish`), though it drops TypeSafe's confidence (it reads Gateway `providerMetadata`).

**Request shape** (morning, first evaluation; strings redacted to their length):

```text
{ state: { user_request: <140>, context: {}, guidance: <0>, capabilities: [ { id, description } × 12 ] },
  questions: { root: { type: "choice", instructions, criteria: { stack, unavailable } },
               select_<n>: { type: "choice", instructions, criteria: { 0..k } | { omit, use:<id> } } × 12 },
  model: "jev-latest" }
second (layout) evaluation: state { user_request, context, selected_elements: [ { id, type, content } ] }, questions order_<node>/parent_<node>
```

No sentinel appeared in any of the 14 bodies: no prop, bound value, binding path or action parameter. The cell ids, the static descriptions and the person's request were sent.

| Scenario, 3 runs each | Valid (catalog + host props) | Composition p50 / max | Per-evaluation p50 / max | Evaluations, input tokens per composition | Stop |
| --- | --- | --- | --- | --- | --- |
| Morning todo (12 candidates) | 3/3 | 491 / 646 ms | 237 / 421 ms | 2 (select, layout), 4663 | `finish` ×3 |
| Clinic clinical-cards region (9 candidates) | 3/3 | 433 / 485 ms | 219 / 259 ms | 2, 2854 | `finish` ×3 |

An earlier identical execution gave the same validity, selections and token counts, with composition times of 463–705 ms (morning) and 415–459 ms (clinic).

**What was chosen.**

- **Morning, membership:** identical in all six runs across both executions. Included: both time-bound replies, the conflict, the travel event, the day timeline and the todo. Left out: the low-priority reply, the FYI digest, waiting-on and the unread count.
- **Morning, arrangement:** unstable. Every run placed a `Columns` holding zero or one child, never two side by side. The conflict's position varied between second and sixth, although the request asked for it first.
- **Clinic region:** identical in all six runs, in the requested priority order: acute/decision-today, above-target, risk above target, overdue follow-up, question for today. Both up-to-date problems were left out.

**Reading.** Jev's membership decisions were consistent and matched the metadata; its sibling ordering and its use of reusable layout primitives were not reliable. A host should therefore:

- prune empty or one-child layout containers;
- order siblings itself from enumerated metadata where order carries meaning;
- keep the region default as the fallback.

These are invented fixtures and one prompt per scenario, not a quality evaluation: no `local` evaluator comparison, budget denial or cancellation was run, so A31 stays open for those parts. The clinic scenario shows composition over flags only; it does not change the privacy rule that a clinical host defaults to `local`.

## Specification tooling — executed, passed

`npm run check`, `npm test`, `npm run verify`: all passed; seven checker unit tests. Syntax checks and `git diff --check` passed. These gates check document structure/tooling only; no runtime lint/typecheck/security gate is claimed.

## Local artifact manifest

Raw logs/reviewer output remain ignored under `.cache/evidence/`, not published sensitive logs. The committed excerpts above are sufficient to report scope/results; hashes identify local originals.

| Path under `.cache/evidence/` | SHA-256 |
| --- | --- |
| `redaction/check.log` | `cef47f86fed50869f1587f2cc3756e0deb3f0cfa5256c1f781b2806dcc2b1f18` |
| `redaction/provenance-probe.log` | `f12f492bcd0bbd20a1e5e16dcbcb8e2e9f0e6e4d202d1863ed76c9f44b4316f5` |
| `pi-examples/22-subagent-foreground.log` | `de0c26e094fffce0c3d90240b41d31d2d56e479afaa2acaf052d8862a3966f37` |
| `pi-examples/23-subagent-background.log` | `43ed737e29ee9249a9da0ac230e02b325208437b9e47c43ccfc8b850b115b629` |
| `pi-examples/24-child-tasks.log` | `04b3582426222d825680c644cad6b1c38d89df7763967130b615eb5901e2b018` |
| `pi-examples/26-coding-agent.log` | `431ebe863b21bb073cd225cd27aef433e982e05fdaef848c1a76a490f5497691` |
| `pi-examples/29-sandbox-per-conversation.log` | `f93a2e4c749acc2cb2d85d11830f9757a7cafb73dde820925821744e35fdd9d4` |
| `pi-examples/31-reload-and-restart.log` | `435ddb57e81cdfcf58e168c6f136f4c07f9f1548656af78844007f08bf46a975` |
| `jev-live.log` | `ac24b15693d020a029ac0688661196bfb3b986162df98bbd73b3837ea8491b29` |
| `jev-live/results.json` | `6666f45f5cb99e45914de734fb039cf844b659357e5ffe1ce65bd9b74cef25a8` |
| `jev-live/morning-request-shape.json` | `28308b1f2bb2f254fd00ea70ff2f734df62f324c958cedc7a9b46e513adf2883` |
| `jev-live/clinic-request-shape.json` | `24aa53dcdf5032e70e5d64aa91e14736e62bffb6063e10a5b92807516c3b1c4e` |
| `json-render-probe.log` | `4955ad00f284ac8aecddee2e6ae1cd4eea795c3555e967216256e3fd63179a4c` |
| `vfs-git-probe.log` | `2653dbad67abf24e13496f0564525baa093367d32f9c44826384fa3ca4585704` |

## Not proved

No v4 runtime, experience renderer, catalog, composer or evaluator, structured delivery state machine, strong provider, budget transport fence, remote sandbox adapter, production Boring VFS/Git adapter, shadcn registry, tldraw implementation/license, or real-model clinical quality has been tested. The standalone scratch VFS/Git probe is only the narrow feasibility evidence described above. Static race findings (failed flush, late dictation, admission/thread creation, crash publication) were not injected/reproduced in a browser. Prior v3 formal verification was blocked by missing Java and explicit deferrals; that is not a v4 passing verification claim.
