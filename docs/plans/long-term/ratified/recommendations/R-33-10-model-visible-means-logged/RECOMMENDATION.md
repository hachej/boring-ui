# R-33-10 — Adopt "model-visible means logged" as a stated invariant

Status: proposed · Source: DeepSeek `docs/architecture.md`, `docs/persistence-catalog.md`
Kind: invariant + docs · Cost: low to state, medium to enforce · Priority: high

## Claim

Write into `docs/procedures/coding-invariants.md`: *anything that reaches a model
request must be reconstructible from the session log.* A new model-visible input
requires a corresponding session event in the same change.

## Why

This is R-33-01 (log as the single owner of session state) restated as a
reviewable rule rather than an architecture. R-33-01 says where truth lives;
R-33-10 says how you know a change violated it — and the second is what actually
survives contact with a merge queue.

It is also independent corroboration. Flue arrived at it (durable input record is
the precondition for invoking pi), and DeepSeek now states it as a hard
invariant with a generated 60-event catalog behind it. Three harnesses, same
conclusion, reached separately.

Our failure mode it catches directly: `harnessPiChatService.readStateBeforeDispose`
reconciles across three or four owners with `seq: Math.max(persisted.seq, liveSeq)`.
That expression exists because model-visible state was allowed to originate
somewhere other than the log.

## Evidence

- `packages/agent/src/server/pi-chat/harnessPiChatService.ts` — `readStateBeforeDispose`, seq reconciliation across owners.
- DeepSeek: *"Model-visible means logged. Anything reaching a model request must be reconstructible from the session log, ensuring durability, replay capability, and UI fidelity across fork/resume."*
- DeepSeek's surface/log-only split: `user/message`, `assistant/message`, `tool/result` derive LLM messages; `hook/invoked`, `fs/observed`, `todo/write` are durable but non-deriving. We have no such distinction — worth copying, because it is what lets a log hold audit records without polluting context.

## What it costs

One invariant paragraph, plus a generated event catalog so the rule is checkable.
DeepSeek generates theirs from source declarations and verifies it in CI. Copy that.

## What it breaks

Every current path that injects into a model request without an event: system
prompt assembly, context files, and (unverified) skill activation. Each needs an
event kind or an explicit `log-only` exemption.

## Refutation

Find a model-visible input where logging it is genuinely wrong — a secret, or
something so large the log becomes the bottleneck. Secrets are the real test: if
BYOK material ever reaches a prompt, this invariant would mandate logging it.
The answer must be "such material never reaches a model request", and that has
not been verified.
