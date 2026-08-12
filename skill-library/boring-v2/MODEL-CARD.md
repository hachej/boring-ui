# Boring v2 Model Card

Guidance for choosing models/reviewers in Boring v2 skills. These are defaults, not limits: escalate when the output is not good enough. Judge the work, not the price tag.

![Boring v2 Model Card Mapping](https://pbs.twimg.com/media/HMLvRFoawAAes0k?format=jpg&name=large)

## Axes

- **Intelligence** — how hard a problem can be handed to the model unsupervised: architecture, ambiguous implementation, debugging, migration strategy.
- **Taste** — judgment quality for UI/UX, copy, API design, code quality, and maintainability.
- **Cost** — practical cost/latency for this repo. Cost is a tie-breaker, not the primary decision for shippable work.

## Default policy

1. Use cheaper/faster models for clear mechanical work.
2. Escalate without asking when the result misses the bar.
3. For anything that ships, prefer intelligence/taste over cost.
4. User-facing work needs a high-taste reviewer.
5. Plans and implementations should get an adversarial review when risk is non-trivial.
6. Never let a cheap model be the only reviewer for risky, broad, public, auth/security, migration, or architecture-changing work.

## Tier table (priority-ordered)

Concrete routing table for factory seats and skills. Within a tier, models are
listed in priority order: pick the first *available* model (quota/runtime),
escalate a tier when the result misses the bar. Factory config
(`factory/policy.yaml`) references tiers, never model IDs — update models
here, not in the factory.

| Tier | Models (priority order) | Quota/runtime notes | Factory use |
| --- | --- | --- | --- |
| T1 frontier | Fable; Sol xhigh | Fable = very token-expensive, AgentHost/pi native. Sol = codex exec only, shared 5h OpenAI window, cap 2 tracks — no durable seats | Concierge + Steward seats (Fable); Sol xhigh = cross-model adversarial pass on plans and class-B PRs |
| T2 strong | Opus 4.8; Sol medium | Opus = Claude Max window. Sol medium shares the Sol window/cap | Hard-tagged beads; default Reviewer seat (Opus); lighter cross-checks (Sol medium) |
| T3 workhorse | Terra; Sonnet 4.6 | Terra = codex model (codex exec runtime, currently very cheap) — cannot hold a pi session; Sonnet 4.6 is the pi-native default | Worker sessions = Sonnet 4.6; codex-delegated mechanical work (git chores, bulk edits) = Terra; triage sweeps |
| T4 mechanical | Luna; Haiku | Luna = codex model, cheapest; Haiku where the automation needs an Anthropic/pi-native runtime | Beadle tick, reconciliation, notifications |

Quota rules:

- Quota is an **availability gate, not an optimizer**: on a rate-limit
  signal, fall to the next model in the same tier.
- If a whole tier is exhausted, **defer** shippable-quality work rather than
  silently downgrading a tier; non-shipping mechanical work may drop a tier.
- No account-rotation machinery until real runs prove quota is the
  bottleneck.

## Workflow defaults

| Workflow | Default model shape | Required reviewer shape | Notes |
| --- | --- | --- | --- |
| `ask-boring` | fast router | none | Should be cheap and concise. It does not do work. |
| `feedback` | fast synthesis | none unless sensitive | Focus on safe capture/redaction, not deep planning. |
| `triage` | balanced reasoning | adversarial if risk/ambiguity | Must classify state and first blocker accurately. |
| `plan` | strong reasoning | adversarial plan reviewer | Review flag path, slices, blockers, proof, and whether the plan is too broad. |
| `plan-loop` alias | same as `plan` | adversarial plan reviewer | Alias/reference only; the loop is the plan skill plus adversarial review. |
| `implement` | strong implementation | standards + spec + thermo when risky | Must produce proof and PR handoff. |
| `implement-loop` alias | same as `implement` | adversarial implementation reviewer | Alias/reference only; the loop is implement → review → fix → re-review → proof. |
| `code-review` | independent reviewer | n/a | Two-axis review: Standards and Spec. |
| `code-review-thermo` | high-taste reviewer | n/a | Strict maintainability/code-judo review. |

## Adversarial reviewer trigger

Use an adversarial reviewer for any of:

- plan affects architecture, auth, security, permissions, billing, secrets, migrations, public API, release, or broad refactor
- unclear flag/rollback path
- more than one implementation slice
- review budget might be exceeded
- UI/UX/copy/API design judgment matters
- implementation adds branching, wrappers, casts, optionality, or cross-layer behavior
- proof is manual-only or waived

## Proof bar for implementation

Every implementation handoff must include at least one concrete proof path:

- **Exact command** — command run, result, and short output summary.
- **Screenshot/demo** — artifact/URL and what to inspect.
- **Manual steps** — exact reproduction/verification path.
- **Waiver** — why proof is not possible or not worth the cost, plus residual risk.

No implementation is done with only “tested” or “looks good”.

## Escalation rule

If the first pass is weak, shallow, generic, or misses project context, rerun with a stronger model or add an independent reviewer. Escalation costs less than shipping mediocre work.

## Human-in-the-loop surface

When a workflow needs owner review, visual review, merge approval, product judgment, or missing information, use the `ask_user` tool when available. This should create a Boring UI inbox entry and keep the workspace as the control plane.

Fallback only when `ask_user` is unavailable: post the same concrete request as a GitHub issue/PR comment.
