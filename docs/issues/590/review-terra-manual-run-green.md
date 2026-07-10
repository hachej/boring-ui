# Terra review — Slice 3B

**Verdict:** GREEN

**Model:** `openai-codex/gpt-5.6-terra`

- Crash reconciliation preserves same-process exclusion: the file store atomically reconciles only unowned persisted active runs before admitting one replacement.
- Dispatcher and stream failures finalize to terminal run states while preserving session and usage metadata.
- Trusted dispatcher and actor capabilities remain available only to boot-time internal directory plugins.
- No blocker or high-severity finding remains.
