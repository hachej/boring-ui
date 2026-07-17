> **#391 status (2026-07-17): historical reference / non-dispatchable.**
>
> Active authority: `docs/issues/391/plan.md` and Decision 25 in
> `docs/DECISIONS.md`. Where this file conflicts, the active authority wins.

# S1-slack-channel - RELOCATED

**Amendment (2026-07-08):** S1 is relocated out of #391 active scope.

**Alternative under review (2026-07-08):** CHAN-A — Slack via the Vercel Chat SDK as transport-only (spike verdict ADAPT). See CHAN-A-chat-sdk-transport.md. Supersedes the flue relocation ONLY IF D-RATIFY-1 is approved; until then the flue path stands.

Slack is no longer a from-scratch `boring-channel-slack` package in this runtime
refactor. It becomes a separate lightweight story: **Slack via flue channels**,
reusing flue channel integration directly.

This stub intentionally carries no #391 beads, verification gates, or PR rows.
Keep the T2 pluggable-surface transport contract in #391; concrete Slack channel
work consumes that contract from its separate story.
