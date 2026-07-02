# Issue #473 Claude Code fable review

Reviewer: Claude Code `--model fable`
Date: 2026-07-01

## Final result

CLEAN.

## Notes

Claude reviewed the complete final diff after two small follow-up fixes:

- public hook defaults host composition to `railOnly: true` using `options.railOnly ?? true`, so re-clicking an active host action re-opens instead of toggling a hidden source pane;
- accent/focus gating rationale was restored at the extracted model location.

Remaining observations were non-blocking documentation/internal-naming notes.
