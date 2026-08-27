# Boring CDC — Initial Requirements

Status: initial requirements for external AI planning/review  
Source intent: build “our Boring CDC” for the Boring stack  
Planning style: follows Boring `/plan` expectations — clarify intent, produce a spec, review adversarially, then split into proofable slices.

## 1. Working Definition

“Boring CDC” means a local-first Change Data Capture / event-log layer for Boring apps and plugins. It should reliably record changes from important Boring data stores, expose those changes to internal consumers, and make downstream automation/UI features reactive without each feature inventing its own polling, sync, or audit mechanism.

If “CDC” is meant differently, treat this document as the first artifact to correct.

## 2. Problem

Boring increasingly has multiple moving parts: workspace state, tasks, sessions, automations, inbox/questions, plugins, files/artifacts, and possibly hosted deployments. Features need to know when data changes, but today that tends to become bespoke:

- polling loops;
- ad hoc event emitters;
- missing or inconsistent audit trails;
- unclear replay/backfill semantics;
- tight coupling between storage, UI, and automations;
- hard-to-debug races across local runtime, browser workspace, CLI, and plugin runtimes.

We want one boring, dependable substrate for “what changed, in what order, and who should react?”

## 3. Goals

### Product goals

- Give Boring apps a canonical change stream for important domain objects.
- Make reactive workspace UX and background automation easier to build.
- Provide replay/backfill so consumers can recover after downtime.
- Preserve enough metadata for debugging, provenance, audit, and user trust.
- Keep the system simple enough for local development and self-hosted/small-team deployments.

### Engineering goals

- Start with one or two high-value data domains, not a platform rewrite.
- Define stable event envelopes and versioning before adding many producers.
- Consumers should be idempotent and checkpointed.
- The CDC layer must not make writes meaningfully slower or fragile.
- Prefer boring storage and operational primitives already used in the repo.
- Provide proof paths: deterministic tests for ordering, replay, idempotency, and failure recovery.

## 4. Non-Goals for the First Version

- Not a general-purpose Kafka replacement.
- Not a multi-tenant enterprise CDC platform on day one.
- Not a guarantee that every file-system mutation is captured initially.
- Not a requirement to expose public webhooks before internal semantics are solid.
- Not a redesign of every persistence model in Boring.
- Not exactly-once distributed processing; prefer at-least-once delivery plus idempotent consumers.

## 5. Candidate MVP Scope

Pick one narrow vertical slice that exercises the full loop:

1. **Producer:** capture changes for one domain, likely tasks, sessions, automations, inbox questions, or workspace artifacts.
2. **Event store:** append canonical events with monotonic ordering and metadata.
3. **Consumer API:** allow consumers to read from a cursor/checkpoint and replay.
4. **One real consumer:** update a UI projection, automation runner, inbox projection, search/index, or audit view.
5. **Proof:** tests that prove append, ordering, replay, duplicate handling, and crash/restart checkpoint behavior.

Recommended first domain: choose the one with the most immediate pain and easiest proof path. If no stronger evidence exists, start with task/session/automation state transitions because they are already event-like and user-visible.

## 6. Core Concepts

### Event envelope

Each captured change should include at least:

- `eventId`: stable unique id.
- `stream`: domain stream name, e.g. `tasks`, `sessions`, `automations`.
- `aggregateType` and `aggregateId`.
- `eventType`: semantic type, not just raw table mutation.
- `schemaVersion`.
- `sequence` or comparable monotonic order within a stream.
- `occurredAt` and `recordedAt`.
- `actor`: user/session/system/plugin where known.
- `source`: CLI, workspace, plugin, automation, migration, etc.
- `payload`: typed event body.
- `metadata`: trace ids, causation/correlation ids, redaction flags.

### Consumer checkpoint

Each consumer should persist:

- consumer name/version;
- stream(s) consumed;
- last committed cursor;
- processing status/error metadata;
- ability to resume safely after crash.

### Delivery semantics

Initial default:

- append is durable before consumers are notified;
- consumers receive at-least-once delivery;
- consumers must be idempotent;
- replay is supported from a cursor or beginning of stream;
- schema evolution is explicit.

## 7. Key Design Questions for AI Review

Ask each AI to challenge these, not assume them:

1. Should events be semantic domain events, raw storage changes, or both?
2. What existing Boring storage layer should own the event log?
3. Do we need cross-process notifications immediately, or is pull/replay enough for MVP?
4. What is the minimum viable ordering guarantee?
5. Which domain is the best MVP producer and why?
6. What consumer proves value without overbuilding?
7. How should event schemas be versioned and migrated?
8. How do we redact secrets/PII while keeping audit usefulness?
9. What backpressure or retention policy is acceptable?
10. What failure modes would corrupt projections or cause silent data loss?

## 8. Acceptance Criteria for MVP

- A documented event envelope and stream contract exists.
- One producer writes events for one chosen domain.
- One consumer reads with a durable checkpoint.
- Consumer can replay from scratch to rebuild its projection.
- Duplicate delivery does not corrupt the projection.
- Tests cover ordering, replay, checkpoint resume, duplicate processing, and schema-version handling.
- Operational docs explain how to inspect the event log, reset a consumer, and diagnose a stuck consumer.
- Rollback path is clear: disable producer/consumer without breaking core writes.

## 9. Proof Path

A good implementation plan should name exact proof commands, but expected proof categories are:

- unit tests for event envelope validation;
- integration tests for append/read/checkpoint semantics;
- crash/restart simulation for consumer resume;
- replay test proving a projection can be rebuilt;
- migration/version test for at least one event schema version bump;
- manual/dev scenario showing a real domain change appears in the consumer projection.

## 10. Planning Expectations

Following Boring `/plan`, a serious proposal should return:

- the chosen planning method;
- the canonical artifact path/URL;
- problem and solution;
- decisions and rejected alternatives;
- flag/rollback strategy;
- test seams and proof path;
- one or a few implementation slices;
- blockers/open questions;
- next action, normally `/skill:exec <target>` after review/approval.

Before implementation, run adversarial plan review and fold material findings into the canonical plan.
