# Agent Interview Intake Plan

Status: proposal, non-binding. `docs/direction/DIRECTION.md` schedules; this
document only records a capability Seneca built on top of Boring primitives
and what it would take to make it a reusable one.

## Goal

Let an agent interview a human against a typed input contract for a job:
the model chooses and phrases each screen, the platform decides
deterministically when the input is sufficient, the human reviews and
confirms, and the result is a frozen, digest-addressed input pack. This is
the input half of a "bounded brief" (vision component 4: a stock MCP client
submits a bounded brief and receives an immutable artifact) and the human
counterpart of `prepare_task` in an MCP task adapter.

## What exists today

`@hachej/boring-ask-user` already gives an agent a typed, blocking form
(`text`, `textarea`, `select`, `multiselect`, `checkbox`, `radio`, `number`)
rendered in the Questions pane. What it does not give is:

- a contract that says which fields are required and when the interview is
  done, independent of the model's opinion;
- provenance per field (typed by the human vs inferred by the model);
- a review-and-confirm step that freezes the input with a digest;
- a chromeless surface for a stranger who is not in a workspace;
- a server-side loop so the interview survives the client closing.

Seneca built these in `src/server/intake/` (see its `docs/intake.md`) for
one task, the Charlotte Ledoux AI Agent Governance Audit. It is live at
`charlotteledoux.senecaapp.ai/intake`. The engine is task-agnostic; the
task definition is still module constants.

## Proposed shape

```ts
interface InterviewTaskDefinition {
  id: string                       // 'charlotte.agent-governance-audit'
  title: string
  brief: string                    // the expert's lenses: what to ask, in what order, what "unknown" means
  fields: InterviewField[]         // id, label, purpose, type, options?, required, section
  defaultLanguage?: string
  copy?: { welcome?: string; done?: string }
}

interface InterviewField {
  id: string; label: string; purpose: string
  type: 'text' | 'textarea' | 'select' | 'multiselect'
  options?: { value: string; label: string }[]
  required: boolean; section: string
}
```

Runtime contract, one model call per screen:

- Input to the model: pack so far, deterministic assessment (missing required,
  unasked optional), transcript, preferred language.
- Output from the model: `{ patch: [{field, value, confidence: confirmed|inferred}], action: ask|done, form?, summary? }`
  where `form` uses the ask-user wire schema (`wireVersion: 1`) and field
  names are contract ids.
- Server rules: answers are written before the model runs; `inferred` never
  overwrites a confirmed value and is flagged at review; `done` is a proposal
  that the assessment can veto; a contract-built fallback form covers a
  model that stalls; confirm refuses an incomplete pack; the frozen pack
  carries a canonical-JSON SHA-256 digest.

Surfaces sharing the same session API:

1. Chromeless web wizard (what Seneca has).
2. The workspace Questions pane, so an agent inside Boring can run the same
   interview against a signed-in user.
3. An MCP `prepare_task` tool: the host agent submits partial context and
   receives the same missing-fields answer; the human confirms in the host.

## Lessons worth carrying into the primitive

- Open-weight models behind OpenAI-compatible endpoints (Infomaniak: Kimi
  K2.6, Qwen 3.5) do not return usable tool calls for a nested form schema
  but answer reliably with a bare JSON object when the schema is in the
  prompt. Offer `outputMode: tool | json | auto`; flatten nullable type arrays.
- Those models think for 500 to 1,200 tokens before the form. Budget
  `maxTokens` ≥ 4096 per screen.
- Keep the operator-only raw model response per session, stripped from the
  user-facing view. It was the only way to diagnose the fallback-form bug in
  production.
- Nonce CSP: any inline page must be nonce-injected or it renders blank.
- Rate-limit only the endpoints that call the model.

## Where it would live

A `plugins/interview` package (server: task registry, session store,
interviewer loop, routes; front: the chromeless wizard as a route-first
surface plus a Questions-pane adapter) that depends on `boring-ask-user`
for the form wire schema and on `pi-ai` for transport. Seneca would then
delete its local copy and register its task definitions.

## Not in scope

Entitlements, execution, reports, revision. Those are the task router's
other halves and belong to the tenant until the pattern recurs.
