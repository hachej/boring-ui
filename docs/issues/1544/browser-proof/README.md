# PR 1544 revision-bound browser proof

This source-backed fixture renders the real `PiChatPanel` from `PROOF_TARGET_ROOT`, records desktop and mobile journeys, and exposes the host's `onTurnComplete` count. The user submits a prompt; a deterministic NDJSON stream then delivers a stale terminal, the current turn's error, a contradictory terminal, and one valid next turn.

```bash
PROOF_TARGET_ROOT=/path/to/revision \
PROOF_REVISION_LABEL=before \
PROOF_EXPECTED_REJECTED_COUNT=2 \
PROOF_OUTPUT_DIR=/tmp/pr1544-before \
pnpm exec playwright test --config docs/issues/1544/browser-proof/playwright.config.ts
```

Use `PROOF_EXPECTED_REJECTED_COUNT=0` for the repaired candidate. Both projects use identical fixture data and steps; viewports are desktop `1440×900` and mobile `390×844`. Base is expected to report two false callbacks before the valid completion (final count 3); candidate must remain at zero through both rejected terminals and finish at exactly one.
