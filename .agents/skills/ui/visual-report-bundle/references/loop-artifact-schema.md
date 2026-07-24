# Explicit-scenario loop artifact schema

Use this schema when the owner explicitly authorizes a bounded scenario that is not yet in the registered UI-review registry. Registered specs retain their repository-owned schema and hard gates.

## Issue layout

```text
docs/issues/<issue>/artifacts/visual-report/
├── round-01-baseline/
│   ├── index.html
│   ├── report.md
│   ├── interaction-results.json
│   ├── operator-invocation.json
│   ├── gate-summary.json
│   ├── critic-invocation.json
│   ├── critic.json
│   ├── fix-plan-decision.json
│   ├── execution-decision.json
│   ├── console-errors.json
│   ├── http-errors.json
│   ├── video-probe.json
│   ├── screenshots/
│   └── videos/run.webm
├── round-02-after-fixes/
└── final-handoff.html
```

Never overwrite a completed round.

## Invocation records

`operator-invocation.json` and `critic-invocation.json` are written from orchestration/runtime metadata, never inferred from model prose:

```json
{
  "role": "visual-evidence-operator",
  "requestedModel": "mac/qwen3.6-35b-a3b",
  "resolvedModel": "mac/qwen3.6-35b-a3b",
  "transport": "pi-subagent",
  "startedAt": "ISO-8601",
  "completedAt": "ISO-8601",
  "status": "passed"
}
```

Compare canonical provider/base-model identity separately from thinking level. A transport suffix such as `:high` records `resolvedThinking: "high"` but is not a model mismatch when provider and base model id match. If canonical requested/resolved provider or base-model ids differ, set `status` to `failed-model-mismatch` and stop that phase. Keep credential, credit, and availability blockers in the invocation record without secrets.

## Gate summary

`gate-summary.json` records deterministic results and separates scenario failures from teardown noise:

```json
{
  "counts": { "PASS": 0, "FAIL": 0, "BLOCKED": 0 },
  "consoleErrors": 0,
  "scenarioHttpErrors": 0,
  "scenarioNetworkFailures": 0,
  "expectedTeardownCancellations": 0,
  "duplicateScreenshotGroups": 0,
  "videoProbe": "passed",
  "hardGatesPassed": true
}
```

Only records with `phase: "teardown"`, `networkFailure` containing `ERR_ABORTED`, and `disposition: "expected-teardown-cancellation"` may be excluded from scenario failure counts.

## Critic result

`critic.json` contains the critic's bounded output:

```json
{
  "verdict": "clean",
  "confidence": 0.0,
  "score": 0.0,
  "visualFindings": [],
  "topFixes": [],
  "materialHighConfidenceFixRemains": false
}
```

The critic may select at most three fixes with confidence `>= 0.8`. A critic without image input must set `visualFindings` to an empty list and may judge only deterministic/text evidence.

## Decisions

`fix-plan-decision.json` records selected fixes, stop conditions, and whether an execution packet is warranted. `execution-decision.json` records whether `/exec` ran and the reviewed revision. Do not invoke `/exec`, recapture, or regrade when there is no selected fix and no product change.

## Final handoff

`final-handoff.html` links only authoritative rounds and includes:

- issue and scenario;
- requested/resolved operator and critic models;
- hard-gate counts;
- embedded screenshots and video;
- critic grade and findings;
- fix/execution decisions;
- stop condition;
- residual risks.
