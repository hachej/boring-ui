# Chat Event Ownership — revision-bound browser proof

## Revisions and scenario

- **Actual PR base / before:** `3db6a237d0ace94c83fb4967e43407d65202706e`. This is the original PR base reported by GitHub and contains the callback-before-reducer bug. The source-backed fixture uses normal hydration (rather than the later `hydrateMessages=false` path), so the exact base can establish its event stream before the prompt without importing unrelated first-prompt behavior.
- **Repaired production code:** `1f91c319958f0a2d37b2badb13174b4068234055`.
- **Report-bound exact proof execution:** `fd08b2b3d3918c9a6a8ab1d49b831bbba60ae939`. Commits after the code SHA contain only Bead/proof artifacts, the bounded cold-start timeout, presentation generation, and metadata sanitization. The Bead handoff binds the later artifact-only presentation refresh to its own exact-SHA rerun.
- **Fixture:** one redacted prompt, session `ownership-proof`, fixed model `anthropic/proof-model`, no credentials, customer data, network backend, or host paths in artifacts.
- **Viewports:** desktop `1440×900`; mobile `390×844`. Playwright scales recorded video to its codec-safe maximum (`800×500` and `368×800` respectively); assertions run at the declared viewport.

The same real browser journey renders `PiChatPanel` from each target revision. The user enters **“Verify terminal event ownership”** and clicks **Submit**. The deterministic NDJSON stream then delivers:

```text
agent-start(turn-current)
agent-end(turn-stale)              # reducer rejects
error(turn-current)                # accepted terminal error
agent-end(turn-current, ok)        # contradictory; reducer rejects
agent-start(turn-next)
agent-end(turn-next, ok)           # one valid completion
```

The fixture renders the host-facing `onTurnComplete` count above the real chat panel. This is necessary because the stock standalone playground does not wire that optional host callback, so its false delivery has no observable browser surface. No production source was changed for testability.

## Assertions and result

| Checkpoint | Before `3db6a237` | Candidate `1f91c319` | Required candidate result |
| --- | ---: | ---: | --- |
| stale terminal consumed | 1 completion | 0 completions | no false completion |
| contradictory terminal consumed | 2 completions | 0 completions | no false completion |
| valid next turn completed | 3 completions | 1 completion | exactly once |
| desktop | PASS (expected regression reproduced) | PASS | PASS |
| mobile | PASS (expected regression reproduced) | PASS | PASS |

The base is intentionally asserted to reproduce two false callbacks rather than recorded as an unexplained failed test. Candidate assertions demand zero callbacks at both rejected checkpoints and exactly one after the valid next turn.

## Commands

Executed on final head in exact-SHA sandbox lease `2f8877ef-485a-4f07-9234-cae31e17d4cd` after `git rev-parse HEAD` and `.factory-sha` both returned `fd08b2b3d3918c9a6a8ab1d49b831bbba60ae939`:

```bash
mkdir -p /tmp/pr1544-proof-base
git archive 3db6a237d0ace94c83fb4967e43407d65202706e | tar -x -C /tmp/pr1544-proof-base
ln -s "$PWD/node_modules" /tmp/pr1544-proof-base/node_modules
ln -s "$PWD/packages/agent/node_modules" /tmp/pr1544-proof-base/packages/agent/node_modules

PROOF_TARGET_ROOT=/tmp/pr1544-proof-base \
PROOF_REVISION_LABEL=before \
PROOF_EXPECTED_REJECTED_COUNT=2 \
PROOF_OUTPUT_DIR=/tmp/pr1544-proof-before \
pnpm exec playwright test --config docs/issues/1544/browser-proof/playwright.config.ts
# PASS: desktop + mobile

PROOF_TARGET_ROOT="$PWD" \
PROOF_REVISION_LABEL=candidate \
PROOF_EXPECTED_REJECTED_COUNT=0 \
PROOF_OUTPUT_DIR=/tmp/pr1544-proof-candidate \
pnpm exec playwright test --config docs/issues/1544/browser-proof/playwright.config.ts
# PASS: desktop + mobile
```

The extracted base gets dependency-only `node_modules` symlinks from the sandbox; all aliased Agent source remains the archived exact base. The common proof fixture is served from the proof head.

## Recordings and machine results

| Revision | Desktop | Mobile | Playwright JSON |
| --- | --- | --- | --- |
| before | [video](results/before/desktop/journey.webm) · [final frame](results/before/desktop/final.png) | [video](results/before/mobile/journey.webm) · [final frame](results/before/mobile/final.png) | [results](results/before/playwright-results.json) |
| candidate | [video](results/candidate/desktop/journey.webm) · [final frame](results/candidate/desktop/final.png) | [video](results/candidate/mobile/journey.webm) · [final frame](results/candidate/mobile/final.png) | [results](results/candidate/playwright-results.json) |

Artifact integrity is recorded in [`results/SHA256SUMS`](results/SHA256SUMS) and passed `sha256sum -c` in the exact-SHA sandbox. Durable links are repository-relative and contain no local host paths in their media payloads.

## Relevant package proof

At report-bound proof execution `fd08b2b3d` in the same sandbox:

- focused Vitest — PASS, 3 files / 184 tests, no type errors;
- `pnpm --filter @hachej/boring-agent typecheck` — PASS;
- `pnpm lint:invariants` — PASS;
- `pnpm audit:imports` — PASS;
- `pnpm --filter @hachej/boring-agent run check:isolation` — PASS.

## Known gaps

- The browser fixture uses deterministic in-browser NDJSON rather than a live model/backend. That isolation is deliberate: it is the only deterministic way to force protocol-invalid stale/contradictory terminal ordering while exercising the real panel/session/reducer/callback path.
- The stock playground does not expose `onTurnComplete`; the proof-only source-backed host makes that callback visible without changing production code.
