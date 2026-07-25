> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

# S1-slack-channel - RELOCATED

**Amendment (2026-07-08):** S1 is relocated out of #391 active scope.

Slack is no longer a from-scratch `boring-channel-slack` package in this runtime
refactor. It becomes a separate lightweight story: **Slack via flue channels**,
reusing flue channel integration directly.

This stub intentionally carries no #391 beads, verification gates, or PR rows.
Keep the T2 pluggable-surface transport contract in #391; concrete Slack channel
work consumes that contract from its separate story.
