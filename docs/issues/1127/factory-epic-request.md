# [WhatsApp Channel] Ship the WhatsApp channel v1

Owner request (2026-09-04) for the Boring Factory. Feature name `WhatsApp Channel`, epic key `whatsapp-channel`. Source of truth: PR #1211's `docs/issues/1127/plan-whatsapp.md` (r4.1) and `docs/issues/1127/plan.md` (r2.1) plus `references/*`. Owner rulings of 2026-08-10 and 2026-08-11 are folded into r4.1; the overnight review verdict was merge-after-fixes with CI green. Existing Beads: `wt-391-forward-1127-channels-plan-4fv` and children `.1` (Meta App Review submission), `.2` (slice 1a), `.3` (slice 1b), `.8` (slice 6).

Goal: the channel registry and descriptor mechanism with WhatsApp as the one built v1 consumer: inbound messages become session turns, outbound replies respect the 24-hour window, owner approvals work in chat, and a thin Cloud API adapter runs against the provisioned pilot number.

## Slices, in dependency order

1. **[WhatsApp Channel] Land the plan** — bring PR #1211's docs onto the epic branch (303 commits behind main; docs only) and raise Gate 1 with the plan overview; the Orchestrator adopts the existing Beads above under this epic's label instead of creating duplicates.
2. **[WhatsApp Channel] Channel core, bindings, inbound path** (slice 1a, Bead `.2`) — proof: fake-channel inbound tests and the create-race test.
3. **[WhatsApp Channel] Durable tail, turn assembly, outbound, 24h window** (slice 1b, Bead `.3`) — proof: durable replay test and template fallback test. Depends on 2. Note the dependency on the #1009 durable event store flag; keep the flag default as ruled.
4. **[WhatsApp Channel] In-chat owner approval** (slice 3) — `ask_user` round-trip through the channel; proof: end-to-end test with the fake channel. Depends on 3.
5. **[WhatsApp Channel] Thin Cloud API adapter** (slice 6, Bead `.8`) — proof: webhook answers the challenge and one inbound/outbound exchange against the pilot number once Meta App Review (Bead `.1`, parallel, owner-owned) is approved; until then a recorded fixture exchange.

## Proof for Gate 2

Workspace and agent suites green, invariants green, the fake-channel end-to-end run recorded, and, if App Review is through, a live exchange receipt.

## Risks

Meta App Review is the long pole and gates only the live demo. Identity is fail-closed and provisioned-only for the pilot; self-serve signup is phase 2 and out of scope. Slice 8 (human takeover) is v2, out of scope.
