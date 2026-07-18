# Boring v2 Model Card

Defaults for model selection. The orchestrator may adapt them to task difficulty,
availability, taste, and cost. Judge the work, not the model name.

## Axes

- **Intelligence:** difficulty handled reliably.
- **Taste:** judgment for design, APIs, and maintainability.
- **Cost:** `low`, `medium`, `high`, or `scarce`; a routing hint, not price data.

## Roles and levels

| Level / role | Default model(s) | Transport | Billing | Cost | Purpose |
| --- | --- | --- | --- | --- | --- |
| L0 worker — easy | GPT-5.5 | Pi | API | low | Clear, bounded implementation |
| L0 worker — medium | Tierra GT | Pi | API | medium | Normal implementation |
| L0 worker — hard | Sol medium | Pi | API | high | Difficult implementation |
| L1 orchestrator-integrator | Sol medium | Pi | API | high | Readiness, delegation, synthesis, integration, handoff |
| L1 tier-1 reviewer | Gemini latest Pro, Grok latest, or Sol high | Pi | API | medium–high | Fresh-context correctness, acceptance, proof, and thermo review |
| L2 tier-2 reviewer | Sol xHigh | Pi | API | high | Plans and medium/hard, structural, risky, or uncertain work |
| L3 tier-3 reviewer | Fable | Claude Code CLI (`--model fable`) | subscription | scarce | Human-gated final falsification verdict |

The orchestrator selects one available tier-1 reviewer per pass and may rotate
providers for independence. Use several only when uncertainty or risk warrants it.

## Review ladder

```text
worker/draft → tier 1 → integrate → tier 2 when triggered
→ integrate → tier 3 when enabled and approved → integrate → re-review → converge
```

- Every canonical plan gets tier-1 then tier-2 review.
- Every code change gets a thermo review: tier 1 for small code; tier 2 for
  complex, structural, or risky code. Docs/config-only changes do not need thermo.
- Tier 2 also runs for unresolved tier-1 uncertainty and before any tier-3 call.
- Reviewers use fresh context. A worker self-check is not independent review.

## Fable mode

The initial `/plan` or `/exec` request may set:

```text
Fable: off | manual-gate
```

Default is `off`. `manual-gate` requires Inbox approval before every Fable call.
Tier-2 review must be clean or have explicit dispositions first.

Before an approved call, a cheaper context-packager prepares the smallest
self-contained review packet that preserves load-bearing context. Fable should
avoid direct repository exploration; when more context is needed, it may delegate
targeted retrieval to a cheaper Sonnet subagent. Fable returns a verdict memo;
a non-Fable integrator applies accepted findings and the normal review loop runs
again.

## Durable review record

Keep review evidence beside the task/plan when practical:

```text
reviewer: tier-1 | tier-2 | tier-3
target: <revision>
verdict: clean | revise
findings: <short summary or link>
```

## Human gate

Use `ask_user` for product intent, risk decisions, tier-3 approval, visual
validation, or merge approval. Fallback: the equivalent GitHub issue/PR comment.
