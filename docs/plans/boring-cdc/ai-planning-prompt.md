# Prompt for AI Reviewers — Plan Boring CDC

You are reviewing an early product/technical requirement for “Boring CDC,” a Change Data Capture / event-log substrate for the Boring stack.

Read `initial-requirements.md` first. Then produce a plan that is useful to an implementation team. Do not write code unless explicitly asked.

## Your Task

Create a concrete technical plan for an MVP. Be opinionated, but call out uncertainty. If a requirement is ambiguous, state your assumption and explain what evidence would change your recommendation.

## Required Output Shape

Return these sections:

1. **Executive recommendation** — 5-10 bullets.
2. **Assumptions** — especially what you think “CDC” should mean here.
3. **MVP scope** — exact producer, event store, consumer, and user-visible proof.
4. **Architecture** — components, data flow, sequence/order guarantees, and failure handling.
5. **Event contract** — envelope fields, example events, versioning strategy.
6. **Consumer contract** — cursor/checkpoint model, idempotency, replay, reset.
7. **Storage choice** — recommended persistence primitive and why; rejected alternatives.
8. **Security/privacy** — redaction, actor/source metadata, secret handling.
9. **Operational model** — inspection, retention, backpressure, stuck consumer recovery.
10. **Implementation slices** — one-session-sized slices with proof path for each.
11. **Tests/proof** — exact categories and representative test cases.
12. **Risks and blind spots** — adversarial critique of your own plan.
13. **Open questions for Julien** — only questions that materially change the plan.

## Constraints

- Prefer a small, boring MVP over a broad platform.
- Avoid exactly-once distributed processing claims; design for at-least-once plus idempotent consumers unless you strongly justify otherwise.
- Avoid adding heavy infrastructure unless the repo already depends on it or the MVP cannot work without it.
- Keep writes reliable: CDC must not make core user writes fragile.
- Plan for schema evolution from the first event.
- Include rollback/disable strategy.
- Include a realistic proof path that an agent can run.

## Scoring Rubric

A strong answer:

- chooses a narrow first domain and defends it;
- distinguishes raw database CDC from semantic domain events;
- handles ordering, replay, and duplicate delivery explicitly;
- has a simple storage/notification design;
- names failure modes and how tests expose them;
- produces slices that can be executed and reviewed independently.

A weak answer:

- invents a large distributed event platform;
- ignores replay/checkpoint semantics;
- assumes exactly-once delivery without proof;
- treats event schema/versioning as future work;
- lacks rollback and operational debugging paths;
- asks many questions but makes no recommendation.
