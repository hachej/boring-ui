# Review Decisions Registry

Tracks what was adopted vs deferred from two external reviews during v1 planning. If you're wondering "why don't we have X?" -- check here before re-litigating.

See also: [DECISIONS.md](./DECISIONS.md) for the locked architectural decisions.

---

## External Architecture Review (Codex, 2026-04-22)

12 findings from an automated architecture review. 4 adopted, 8 deferred.

### Adopted

#### 1. Workspace CRUD inconsistency

| | |
|---|---|
| **Finding** | HTTP surface exposed `/api/v1/agent/workspaces` CRUD that conflicted with the single-workspace-per-instance model. |
| **Action** | Removed workspace CRUD routes; session routes trimmed to match. |
| **Rationale** | Workspace management belongs to `@boring/cloud`, not `@boring/agent`. Exposing it here creates two sources of truth. |
| **Implementing beads** | boring-ui-v2-ce6 (PiSessionStore), boring-ui-v2-983 (UI bridge routes) |

#### 2. Exec safety caps

| | |
|---|---|
| **Finding** | `exec()` had no timeout or output-size limits, risking runaway processes and OOM. |
| **Action** | Added `ExecOptions { timeoutMs, maxOutputBytes }` and `ExecResult { durationMs, truncated }` with Uint8Array-typed stdout/stderr. |
| **Rationale** | Defense-in-depth. Even trusted code can hang or produce unbounded output. |
| **Implementing beads** | boring-ui-v2-p7c (sandbox interface), boring-ui-v2-pf0 (BwrapSandbox) |

#### 6 (partial). Vercel API resilience

| | |
|---|---|
| **Finding** | Vercel SDK calls had no retry or circuit-breaker logic. Full recommendation included lease/heartbeat/reconciler. |
| **Action** | Added circuit breaker wrapping the Vercel SDK client. Skipped lease/heartbeat/reconciler (cloud-package territory). |
| **Rationale** | Circuit breaker covers transient failures. The heavier machinery belongs in `@boring/cloud` where sandbox lifecycle is managed. |
| **Implementing beads** | boring-ui-v2-2ux (VercelSandbox) |

#### 11. Export surface consistency

| | |
|---|---|
| **Finding** | Export names were inconsistent (`SessionList` vs `SessionToolbar`, extra dialogs and hooks). |
| **Action** | Decision #15 rewritten. Locked exports: `SessionToolbar` (not `SessionList`); removed rename/delete dialogs and `useRegisterTool` hook. |
| **Rationale** | Smaller, consistent surface is easier to maintain and less likely to break consumers. |
| **Implementing beads** | boring-ui-v2-ebn (DECISIONS.md, decision #15) |

### Deferred

Items deferred under the "ship fast, accept known risk" principle. Each includes the accepted risk and the trigger for revisiting.

#### 3. Optimistic write concurrency

| | |
|---|---|
| **Finding** | Multi-tab editing silently uses last-write-wins with no conflict detection. |
| **Accepted risk** | `risk.multi-tab-concurrency` -- users may lose edits in rare multi-tab scenarios. |
| **Why deferred** | Optimistic concurrency (ETags, version vectors) adds complexity across the entire write path. Single-tab is the dominant use case in v1. |
| **Revisit when** | Users report lost edits from multi-tab usage. |

#### 4. CanonicalSessionStore (SQLite)

| | |
|---|---|
| **Finding** | Pi's JSONL session format may drift from our SessionStore interface. A canonical SQLite store would decouple them. |
| **Accepted risk** | Pi JSONL is the only session backend. Format changes in pi could break session loading. |
| **Why deferred** | JSONL works today. SQLite adds a native dependency. The SessionStore interface is the migration seam. |
| **Revisit when** | Session data grows large or pi JSONL format changes break us. |

#### 5. Performance budgets + benchmarks

| | |
|---|---|
| **Finding** | No performance targets or benchmark suite. |
| **Accepted risk** | Performance regressions go undetected until user complaints. |
| **Why deferred** | No users yet means no baseline to measure against. Premature benchmarks test the wrong things. |
| **Revisit when** | Users report latency issues or the product reaches steady-state usage. |

#### 6 (majority). Lease/heartbeat/reconciler

| | |
|---|---|
| **Finding** | Full Vercel sandbox lifecycle management with lease renewal, heartbeat monitoring, and orphan reconciliation. |
| **Accepted risk** | Orphan sandboxes may accumulate if the agent crashes without cleanup. |
| **Why deferred** | Cloud-package territory. `@boring/agent` creates sandboxes; `@boring/cloud` should manage their lifecycle. |
| **Revisit when** | `@boring/cloud` development begins or orphan sandbox costs become material. |

#### 7. Plugin name reservation + namespacing

| | |
|---|---|
| **Finding** | Plugin names are not namespaced. Two plugins with the same tool name silently overwrite each other (last-registered wins). |
| **Accepted risk** | `research.plugin-name-collision` -- tool name collisions in multi-plugin setups. |
| **Why deferred** | Plugin ecosystem doesn't exist yet. Designing namespacing before usage patterns emerge risks over-engineering. |
| **Revisit when** | Third-party plugins ship and name collisions are reported. |

#### 8. Control plane (policy/audit/telemetry)

| | |
|---|---|
| **Finding** | No policy enforcement, audit logging, or telemetry infrastructure. |
| **Accepted risk** | No observability into agent behavior beyond server logs. |
| **Why deferred** | Control plane is operational infrastructure. v1 ships to developers who can read logs. |
| **Revisit when** | The product is deployed in managed/enterprise contexts requiring audit trails. |

#### 9. ChangeReviewDrawer (review-before-apply)

| | |
|---|---|
| **Finding** | No UI for reviewing file changes before they're applied. |
| **Accepted risk** | Users see changes only after they're written to disk. |
| **Why deferred** | This is a workspace-package feature (`@boring/workspace`). The agent applies changes; the workspace UI reviews them. |
| **Revisit when** | `@boring/workspace` ships its file change review flow. |

#### 10. M0.5 invariant-tests milestone

| | |
|---|---|
| **Finding** | Recommended a dedicated milestone for cross-cutting invariant tests before M1. |
| **Accepted risk** | Invariants are verified ad-hoc rather than systematically. |
| **Why deferred** | Invariants emerge via normal code review and test writing. A dedicated milestone would delay shipping. |
| **Revisit when** | Recurring invariant violations suggest systematic gaps. |

---

## Product/UX Review (Internal, 2026-04-22)

12 findings from an internal product review. All 12 adopted.

### Adopted

#### 1. Stream resumption in v1

| | |
|---|---|
| **Finding** | Stream resume was originally deferred to post-v1. Review argued it's table-stakes for chat UX. |
| **Action** | Promoted to M3a milestone: ring buffer + cursor-based reconnection. |
| **Implementing beads** | boring-ui-v2-wna (stream resumption), boring-ui-v2-f3i (E2E resume test) |

#### 2. Uint8Array-typed exec output

| | |
|---|---|
| **Finding** | Exec output should be binary-safe, not string-only. |
| **Action** | `ExecResult.stdout` and `ExecResult.stderr` typed as `Uint8Array`. |
| **Implementing beads** | boring-ui-v2-p7c (sandbox interface) |

#### 3. Slash commands

| | |
|---|---|
| **Finding** | Chat needs local commands (`/clear`, `/reset`, `/model`, `/help`, `/cost`) for power users. |
| **Action** | Client-side slash command system with parser, registry, and 5 builtin commands. |
| **Implementing beads** | boring-ui-v2-qfp (slash commands), boring-ui-v2-uv5 (E2E slash command tests) |

#### 4. CLI SSH/headless detection

| | |
|---|---|
| **Finding** | `--open` should detect SSH sessions and headless environments to avoid broken browser launches. |
| **Action** | CLI detects `$SSH_TTY` / `$SSH_CONNECTION` and skips browser-open. `--no-open` flag for explicit opt-out. |
| **Implementing beads** | boring-ui-v2-i2a (CLI) |

#### 5. Auto-gitignore for workspace artifacts

| | |
|---|---|
| **Finding** | Agent-generated artifacts (`.boring/`, session files) should be auto-gitignored. |
| **Action** | CLI appends to `.gitignore` on first run. `--no-gitignore` flag to opt out. |
| **Implementing beads** | boring-ui-v2-i2a (CLI) |

#### 6. Heartbeat events during long tool calls

| | |
|---|---|
| **Finding** | Long-running tools (bash, code execution) show no progress. Users think the UI is frozen. |
| **Action** | Server emits `data-status` chunks every 2s with `{ toolCallId, elapsedMs }`. Client `<Tool>` component shows elapsed timer. |
| **Implementing beads** | boring-ui-v2-sxh (heartbeat events) |

#### 7. Vercel snapshot retention

| | |
|---|---|
| **Finding** | Snapshots accumulate without cleanup. Keep-last-N policy needed. |
| **Action** | `BORING_AGENT_SNAPSHOT_KEEP` env var (default: 2). Oldest snapshots pruned on new snapshot creation. |
| **Implementing beads** | boring-ui-v2-2ux (VercelSandbox) |

#### 8. CSS-var / Tailwind contract

| | |
|---|---|
| **Finding** | Need a worked example showing how `--boring-chat-*` custom properties integrate with Tailwind. |
| **Action** | `theme.css` ships with all custom property definitions. Documentation includes Tailwind mapping example. |
| **Implementing beads** | boring-ui-v2-2pe (theme CSS) |

#### 9. Session changes endpoint

| | |
|---|---|
| **Finding** | Originally rejected, then upgraded to adopt for Claude Code parity. Tracks file changes per session. |
| **Action** | `GET /api/v1/agent/sessions/:id/changes` returns `{ files: SessionFileChange[] }`. |
| **Implementing beads** | boring-ui-v2-983 (UI bridge routes) |

#### 10. CLI `--logout` / `--reset-key` flags

| | |
|---|---|
| **Finding** | Users need a way to clear stored credentials without manually finding config files. |
| **Action** | CLI flags for credential management. |
| **Implementing beads** | boring-ui-v2-i2a (CLI) |

#### 11. Windows support statement

| | |
|---|---|
| **Finding** | Need an explicit stance on Windows support. |
| **Action** | WSL2 only. Native Windows is not supported. Documented in README. |
| **Implementing beads** | boring-ui-v2-1m4 (README) |

#### 12. Test strategy statement

| | |
|---|---|
| **Finding** | Need an explicit testing philosophy to guide contributors. |
| **Action** | Unit tests via Vitest, E2E via Playwright, type-level tests via `test-d.ts`. Invariant checks in `scripts/check-invariants.sh`. |
| **Implementing beads** | boring-ui-v2-xgv (E2E infra), boring-ui-v2-uxs (E2E logging harness) |

---

## Summary

| Source | Total | Adopted | Deferred |
|---|---|---|---|
| Codex architecture review | 12 | 4 | 8 |
| Internal product/UX review | 12 | 12 | 0 |
| **Total** | **24** | **16** | **8** |

Estimated impact: ~300 LOC added over pre-review baseline (net v1 ~ 3,070 LOC).

---

## Changelog

Track upgrades of deferred items here. When a deferred risk materializes, create a new bead and add a row.

| Date | Item | Action | Bead |
|---|---|---|---|
| *(none yet)* | | | |
