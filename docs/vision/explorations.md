# Explorations ledger — what we tried, what it proved

Every spike, study, and evaluation behind the vision's decisions, in one
table a reader can trust. Each entry: what it was, the verdict, and where
the evidence lives. Entries are dated and never silently rewritten — a
superseded verdict gets a new line, not an edit.

| Exploration | Date | Verdict | Evidence |
|---|---|---|---|
| **SaaS hybrid shell spike** — rebuild the whole multi-agent IA by recomposing components that already ship | 2026-08-25/26 | **Ratified as specification** at immutable commit `08cc60523`: the IA is reachable without new invention; the thread chat mounts a real single-agent session; the multi-voice transcript remains the unproven core | branch `weekend/saas-hybrid-spike`; cited file:line throughout [`shell-plan.md` §2](../plans/multiagent-shell/shell-plan.md) |
| **Meridian Shell design canvas** — owner-iterated visual mockups (8 artboards: shell, thread canvas, inbox, collapsed nav, tree popover…) | 2026-08-25/26 | **Ratified as specification**: settled the visual language, the five-domain nav with Search on top, and the one-workbench/four-mounts grammar | RECONCILIATION §8(b); design lineage in the [pack README](../plans/multiagent-shell/README.md) |
| **Buzz relay study** — how a no-relay, no-protocol multi-agent product coordinates | 2026-08-25 | Coordination can dissolve into a shared durable log with per-agent subscribers — but nobody holds loop caps or spend. Mapped as a *third* candidate ("thread as durable event stream + subscribers"), possible only after durable streams; caps stay host-enforced | [north-star ledger](../plans/multiagent-shell/north-star-ledger.md), 2026-08-25 entries |
| **Grok Bot deep-dive** — three-way comparison against our relay design | 2026-08-25 | Validates our two boundaries as safety, not style: shared-VM implicit context is disclaimed by its own vendor as not a security boundary; no loop control burns budgets; fragmented threads lose the job. Steal for later: description-matching routing with explicit @-override | [north-star ledger](../plans/multiagent-shell/north-star-ledger.md), 2026-08-25 entry |
| **Flue / celld durability evaluation** — should we adopt an external durable-execution runtime? | 2026-08 | **Copy the Durable Object pattern, adopt neither.** Flue runs our own Pi harness under the hood (integrating it would be circular); celld means one deploy per fleet — deferred. The real gap it exposed is execution projection, which the durable-streams premise now owns | Flue seam notes in [`V2-PORT-HANDBOOK.md`](../plans/long-term/ratified/V2-PORT-HANDBOOK.md); Level-D premise in [`premises.md`](../plans/multiagent-shell/premises.md) |
| **Sandbox technology decision** — gVisor/runsc vs Firecracker for the own-cloud fleet | 2026-08 (final) | **Firecracker microVMs.** Supersedes the earlier gVisor-based own-cloud design; the non-binding cloud vision note still describing gVisor carries a contradiction banner | `docs/issues/1081/tech-choice.md` (final owner decision); caveats in [`cloud-vision/README.md`](../plans/agent-runtime/cloud-vision/README.md) |
| **Persistent console spike line** — session console, left-pane view modes | 2026-08 (lineage) | Produced the console substrate plan and the left-pane row model the shell's nav chrome descends from; its single-session thread-ref shape is now blocked on the storage spike | `docs/issues/1355/plan.md`; PRs #1357, #1393 |
| **Agent cloud vision note** — one-command agent deploy, three-layer cloud | 2026-07 | Explicitly **non-binding**; kept as inspiration with four named contradictions the ratified side wins | [`cloud-vision/`](../plans/agent-runtime/cloud-vision/README.md) |
| **Live transcription V0** — local CPU meeting transcript with in-chat reviews | 2026-07 | Built and complete behind a default-off flag; blocked on owner demo | `docs/issues/912/plan.md`; bead `wt-391-forward-gh912-live-transcript-8r4g` |
| **Excel/workbook agent spike** | 2026-07 | Build-but-reshape: viable, but not on the critical path; code parked uncommitted pending its own lane | spike worktree `~/projects/wt-excel-spike` (off-repo) |
| **Thread-storage spike** — first-class record vs projection | **not yet run** | The one exploration the program *requires* before the engine's first slice; brief includes a competitor study | brief in [`premises.md`](../plans/multiagent-shell/premises.md) (P2) |

## How to add an entry

One row per exploration, verdict in plain product words, evidence as a link
a reviewer can open. If a verdict is later overturned, add a new row naming
the supersession — the ledger is append-only in spirit.
