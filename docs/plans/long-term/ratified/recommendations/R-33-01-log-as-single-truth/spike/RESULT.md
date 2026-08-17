# Spike — pi on host-supplied storage

## Question

**Hypothesis:** pi can be constructed with host-supplied `SessionStorage` on our pinned
`@earendil-works/pi-agent-core@0.80.7`, with its own session directory left untouched.
**Refuted if:** the injection seam is absent at 0.80.7, or pi writes to its own store, or a second
process cannot continue the conversation from the host store.
**Why reading cannot settle it:** the seam is documented for a newer version; Flue depends on ^0.83.0.

## Pinned

`origin/main` e546c3807 · node v22.22.1 · `pi-agent-core@0.80.7`, `pi-coding-agent@0.80.7`,
`pi-ai@0.80.7` · model `google/gemini-2.5-flash`

## Result

**Verdict: confirmed. No upgrade required.**

```json
{
  "first":  { "pid": 2393432, "text": "STORED ORCHID-7319", "stopReason": "stop" },
  "second": { "pid": 2393565, "text": "ORCHID-7319",        "stopReason": "stop" },
  "processBoundaryProved": true,
  "defaultSessionRoot": "/home/ubuntu/.pi/agent/sessions",
  "defaultSessionSnapshotBefore":      "42d748c119fbc69c…",
  "defaultSessionSnapshotAfterSecond": "42d748c119fbc69c…",
  "defaultSessionTreeUnchanged": true
}
```

Turn 2 ran in a **different PID** and recalled the secret from turn 1, reading only the host-owned JSONL
stream. Independently checked with `find ~/.pi/agent/sessions -newermt '-10 minutes'` → empty.

**Not proven:** tool-calling through this seam; only chat turns were exercised. The worker's sandbox
blocked vault, so the orchestrator supplied the key and ran the live turns.

## Code

`~/projects/spike-pi-storage` — **not yet pinned or committed.**
