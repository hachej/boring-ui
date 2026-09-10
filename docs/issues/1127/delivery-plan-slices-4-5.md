---
github: https://github.com/hachej/boring-ui/issues/1127
issue: 1127
state: needs-owner-approval
updated: 2026-09-09
flag: BORING_AGENT_CHANNELS
track: owner
---

# WhatsApp Slices 4 and 5 — delivery plan

## Problem

The durable WhatsApp text/approval runtime landed through PR #1550, but artifact delivery and inbound photos/voice notes remain open. The owner asked this lane to implement them on `epic/whatsapp-channel`, preserve the earlier batch lineage, and drive one new PR to its most advanced authorized state.

The request's “PR #1127” is factually a closed GitHub issue, not a pull request (`gh pr view 1127` returns no PR; the API identifies issue #1127). PR #1550 is merged at the branch's current head. This lane will therefore open one PR from the required branch to `main` after implementation; it will not invent or modify PR #1127.

## Decisions

- Preserve the provisioned-only, fail-closed identity model already landed.
- Slice 4 uses the existing authenticated workspace share-resource seam. No public unauthenticated links or capability secrets in URLs.
- PDF delivery is snapshot-on-publish and uses WhatsApp document messages.
- Slice 5 stores media in the bound workspace/approved CH/EU path, routes photos through the existing image attachment seam, and adds a batch-file seam beside self-hosted transcription. No US media processor.
- Unsupported PDFs receive an honest response. Mid-turn media fails closed unless an existing public attachment contract safely supports it.
- App deployment and Meta App Review are owner-only because they cross credential, external-account, and release boundaries. The owner should provide authorization/configuration through approved secret/deploy surfaces, never credential values in chat.
- Expected package production churn may exceed 500 lines and likely changes package seams; final classification is therefore presumed protected unless exact final-diff arithmetic and independent abstraction review prove otherwise. No scope splitting to evade the threshold.
- No force-push, merge, deployment, file deletion, proof waiver, or weakened assertion.

## Test seams

- Highest seams: authenticated workspace share-resource contract; WhatsApp adapter parse/send contract; Agent channel inbound/outbound contract; transcription plugin's supported server seam.
- Real callers: app-host channel composition, bound workspace session, Meta adapter fixtures, and self-hosted transcription adapter.
- Proof: focused producer/consumer tests, affected typechecks, `pnpm lint:invariants`, `pnpm audit:imports`, exact-SHA sandbox verification, deterministic end-to-end scenarios, final-head CI, independent standards/spec + thermo + explicit abstraction PASS.
- UI/runtime evidence: Playwright before/after video for any observable UI journey; otherwise revision-bound channel runtime evidence with UI marked N/A and justification.

## Bead graph

- `epic-whatsapp-channel-1ve3` — epic.
- `epic-whatsapp-channel-1ve3.1` — owner-only Meta App Review, parallel and non-blocking.
- `epic-whatsapp-channel-1ve3.2` — owner-only deployment decision/action, parallel and non-blocking.
- `epic-whatsapp-channel-1ve3.3` — Slice 4 artifact share-link + immutable PDF delivery; first engineering slice.
- `epic-whatsapp-channel-1ve3.4` — Slice 5 inbound photos + voice notes; blocked by `.3` to honor requested dependency order and avoid overlapping channel seams.
- `epic-whatsapp-channel-1ve3.5` — current-main integration, proof, final independent review, PR creation/update, and risk routing; blocked by `.4`.

All carry `epic:whatsapp-slices`. Lineage is canonical batch Bead `wt-391-forward-1127-channels-plan-4fv`; that batch epic is read-only to this lane.

## Acceptance

1. Authenticated share link and immutable PDF snapshot are sent without leaking paths/secrets.
2. Photo reaches the model through the supported attachment path.
3. Voice note is retained, transcribed through the approved self-hosted path, and answered.
4. Unsupported PDF and unsafe/mid-turn media behavior are explicit and fail closed.
5. Relevant exact-SHA checks, final CI, adversarial review, thermo, and explicit package-abstraction review pass with no material finding open.
6. One PR from `epic/whatsapp-channel` to `main` carries durable proof and present-pr.
7. Final route is either host-authorized `factory: MERGE-READY <sha>` or one exact-SHA merge approval card. The Orchestrator never merges.

## Rollback

Revert the slice commits/PR. Keep `BORING_AGENT_CHANNELS` off to make the channel host unreachable. No migration or destructive data operation is authorized by this plan.

## Plan review

The current host exposes no independent plan-review mechanism other than Worker dispatch, and dispatch is forbidden before Gate 1. The gate is therefore raised with this explicit limitation; implementation still requires exact-final-SHA independent review within the four-round cap.
