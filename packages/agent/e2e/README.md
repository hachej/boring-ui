# @boring/agent E2E Tests

Playwright-based end-to-end tests for the agent UI and API surface.

## Prerequisites

```bash
npx playwright install chromium
```

Requires `ANTHROPIC_API_KEY` for tests that hit the real LLM. Tests that need it
skip gracefully when the key is absent or set to the placeholder `e2e-test-key`.

## Running

```bash
# All e2e specs
pnpm test:e2e

# Single spec file
pnpm test:e2e -- tool-rendering.spec.ts

# Headed mode (opens browser)
pnpm test:e2e -- --headed
```

## Structure

| File | Coverage |
|------|----------|
| `infra.spec.ts` | Fixture boot: health check, seeded workspace, browser load |
| `a11y.spec.ts` | Accessibility audit |
| `bridge-protocol.spec.ts` | Client-server bridge protocol |
| `m2-modeflip.spec.ts` | Execution mode switching |
| `m3a-sessions.spec.ts` | Session CRUD + stream resume |
| `m3b-chat.spec.ts` | Slash commands, bash/edit tool cards, heartbeat |
| `tool-rendering.spec.ts` | Tool card rendering for read/write/find/grep + state transitions |
| `streaming-bash.spec.ts` | Bash streaming: multi-line output, error exit, heartbeat, SSE protocol |

## Regression Tests

```bash
pnpm test:regression   # system-prompt-size budget check
```

## CI Notes

- Tests run `workers: 1` in CI to avoid port/resource contention.
- `fullyParallel: false` — specs share a backend server per test file.
- Traces and screenshots captured on failure (`e2e-artifacts/`).
