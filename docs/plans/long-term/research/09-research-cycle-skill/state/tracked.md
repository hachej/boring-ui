# Tracked targets

A run diffs against `last_checked`; it does not re-read from zero.

## Competitors

| target | last_checked | how |
|---|---|---|
| Flue | 2.0.3 | `npx @flue/cli@<v> docs` — bundled offline docs, authoritative |
| eve (Vercel) | 0.31.3 | `npm pack eve@<v>` + vercel.com/docs/eve (needs node>=24 to RUN) |
| opencode | 1.18.16 | github.com/anomalyco/opencode + opencode.ai/v2/docs |
| Anthropic Managed Agents | 2026-08 | platform.claude.com/docs/en/managed-agents |
| Mastra | 2026-08 | only tracked for its FGA authorization model |
| LangGraph Platform | 2026-08 | only tracked for per-resource auth / workspace RBAC |
| pi | 0.80.7 (we pin) / 0.83.x (upstream) | installed source + pi.dev — **our own dependency, check every run** |

## Subsystem audit rotation

One per run, in order. Restart at the top when exhausted.

1. credentials · 2. authorization/governance · 3. provisioning · 4. plugins/trust
5. wire/protocol · 6. durability · 7. tools/catalog · 8. DX/onboarding

## Rules

- pi is tracked as a **competitor to our own reimplementations**: every cycle asks what pi now does
  natively that we still maintain ourselves.
- A competitor with no version change since `last_checked` is skipped, not re-read.
