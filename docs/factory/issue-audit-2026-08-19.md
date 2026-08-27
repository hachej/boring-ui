# Open-issue audit — 2026-08-19

97 open issues audited. Evidence: merged-PR search, beads DB (`.beads/beads.db`), code checks
(HtmlViewer has no mermaid; MessageTimeline is dead except its own test). PRs #1312 and #1320 are
still **open**, so #1304/#1254 are in-flight KEEPs, not fixed. Age = days since created.

Dispositions: KEEP (grouped by lane), CLOSE-fixed, CLOSE-dup-of-N, CLOSE-superseded, CLOSE-stale, PARK.

## KEEP — Lane A: UI polish blitz (bead epic `gb0o` / gh-1110)

| # | Age | Disposition | Reason | Lane |
|---|-----|-------------|--------|------|
| 1110 | 13d | KEEP | Epic umbrella for the polish lane; live children below | A |
| 873 | 30d | KEEP | ask_user refresh bug; active bead `bug-873-askuser-refresh-0dg` | A |
| 1171 | 11d | KEEP | Reload-agent affordance; fits polish lane | A |
| 1190 | 9d | KEEP | Pane-resizer unification, child of 1110 | A |
| 1290 | 5d | KEEP | Stale model in composer; bead `9jxj` in_progress | A |
| 1295 | 5d | KEEP | Stop deletes queued messages; bead `wul5` | A |
| 1296 | 5d | KEEP | Generic Agent seat in factory workspace; bead `yqvu` | A |
| 1297 | 5d | KEEP | File-surface tabs; bead `n9bd` | A |
| 1298 | 5d | KEEP | Archive-session context menu; polish lane | A |
| 1300 | 5d | KEEP | Automation session missing from inventory; bead `gb0o.1` | A |
| 1303 | 4d | KEEP | 4.3MB eager bundle; bead `ybkr` in_progress | A |
| 1304 | 4d | KEEP | Inline artifact list; bead `gb0o.2`, PR #1312 OPEN | A |
| 1306 | 4d | KEEP | ask_user stale-intention supersede; real triaged bug | A |
| 1307 | 4d | KEEP | Rename reverts; bead `4yi6` (auto-title overwrite) | A |
| 1323 | 2d | KEEP | No optimistic echo on send; distinct defect, polish lane | A |
| 1337 | 0d | KEEP | Inbox placeholder titles / dropped questions; bead `p820` | A |
| 1338 | 0d | KEEP | Session-inventory full-store parse (16s); bead `s4wq`; distinct from 1303 | A |

## KEEP — Lane B: factory-on-CLI hardening (bead epic `d5nj` / gh-1187)

| # | Age | Disposition | Reason | Lane |
|---|-----|-------------|--------|------|
| 1187 | 9d | KEEP | Epic, actively shipping (PRs #1202–#1209, #1227, #1302) | B |
| 1189 | 9d | KEEP | Canonical for instruction-link resolution in CLI hub (1197 dups it) | B |
| 1191 | 9d | KEEP | Local hosts read AGENTS.md; bead `d5nj.2` in_progress | B |
| 1196 | 9d | KEEP | Ambient-skill symlink 500s; bead `d5nj.3` | B |
| 1199 | 9d | KEEP | Flaky insufficient-credit replay test; bead `d5nj.1` in_progress | B |
| 1206 | 9d | KEEP | Verified NOT fixed: HtmlViewer has zero mermaid support (#1326 was only a dep bump) | B |
| 1223 | 8d | KEEP | BORING_AGENT_FLEET retirement; follows 1187 composition work | B |
| 1233 | 7d | KEEP | DX onboarding 6→2 concepts + verified scaffold defect | B |
| 1253 | 6d | KEEP | ui-review mktemp leak; bead `d5nj.4`; distinct from 1254 (leak vs policy) | B |
| 1254 | 6d | KEEP | /tmp aging + pnpm-store rule; bead `d5nj.5`, PR #1320 OPEN | B |

## KEEP — Lane C: external MCP ingress (bead epic `rjkl` / gh-1129)

| # | Age | Disposition | Reason | Lane |
|---|-----|-------------|--------|------|
| 1129 | 12d | KEEP | Epic; beads `rjkl.1/.3/.4` active | C |
| 1011 | 19d | KEEP | User-registered MCP lane; SSRF bead `1011-connect-time-ssrf-x35` | C |
| 900 | 28d | KEEP | Composio full-catalog mode; bead `rjkl.2` (reland) | C |

## KEEP — Lane D: hosted external plugins (gh-1261, Seneca)

| # | Age | Disposition | Reason | Lane |
|---|-----|-------------|--------|------|
| 1261 | 6d | KEEP | Epic for hosted user-authored plugins | D |
| 1274 | 5d | KEEP | delegate_task plugin, child of 1261 | D |
| 1275 | 5d | KEEP | Governed search/fetch plugin, child of 1261 | D |
| 1276 | 5d | KEEP | Orchestrator plugin; bead `rctz` in_progress | D |

## KEEP — Program #391 / Decision-28 / AgentGateway (beads `xn9`, `0jpy`, `xp3s`)

| # | Age | Disposition | Reason | Lane |
|---|-----|-------------|--------|------|
| 391 | 55d | KEEP | Program anchor; huge live bead graph (`xn9` family) | 391 |
| 905 | 28d | KEEP | AgentHost/Gateway extraction; `0jpy` bead family active | 391 |
| 1009 | 19d | KEEP | Streaming durability B→D; bead `0jpy.8` (durable streaming core) | 391 |
| 1060 | 15d | KEEP | Slice 1 merged (#1102); remaining guarantees ready-for-human | 391/owner |
| 1081 | 14d | KEEP | Sandbox runtime epic; Blaxel PRs #1236/#1247/#1249 shipped, epic continues | 391 |
| 1082 | 14d | KEEP | BYOK tenant keys epic (user-first ruling in force) | 391 |
| 1106 | 13d | KEEP | Fleet loader epic; `xp3s` beads active | 391 |
| 1107 | 13d | KEEP | Agent-as-plugin-package epic; bead `xp3s.4` in_progress; #1202 shipped part | 391 |
| 1123 | 12d | KEEP | Executable environments = xn9 F2 bead lane | 391 |
| 1125 | 12d | KEEP | Run leases; multi-replica prerequisite for hosted automations | 391 |
| 1185 | 10d | KEEP | Scheduled removal of runtime-identity v1 seam (D10) | 391 |
| 1314 | 2d | KEEP | Ledger placement; pairs with bead `0jpy.14` durable ledger | 391 |

## KEEP — bugs with live beads / other

| # | Age | Disposition | Reason | Lane |
|---|-----|-------------|--------|------|
| 371 | 57d | KEEP | Codex context-overflow crash; bead `bug-371-context-overflow-n0z` | bugs |
| 601 | 40d | KEEP | provisionWorkspace=false kills remote chat; bead `bug-601-provision-remote-eal` | bugs |
| 877 | 30d | KEEP | Fly/Neon decommission; real ops with owner gate | owner |
| 883 | 29d | KEEP | app-left indicator bug; touched by #973 — needs one manual re-check, then close | owner |
| 1028 | 19d | KEEP | Verified still dead code (only its own test imports it); 30-min mechanical PR | mechanical |
| 1127 | 12d | KEEP | External channels epic; WhatsApp beads `4fv.1-3` open | vertical |
| 1177 | 10d | KEEP | Visual-docs epic; S1/S2 merged (#1179/#1182), remainder open | docs |

## CLOSE-fixed (16)

| # | Age | Disposition | Reason | Lane |
|---|-----|-------------|--------|------|
| 871 | 30d | CLOSE-fixed | UI review completed in PR #874 (merged 07-25) | — |
| 875 | 30d | CLOSE-fixed | Autoresearch pilot shipped in PR #881 | — |
| 938 | 26d | CLOSE-fixed | Package-owned skill resources shipped in PR #970 | — |
| 1056 | 15d | CLOSE-fixed | Boundary definitions landed in PR #1057 | — |
| 1070 | 15d | CLOSE-fixed | Streaming dictation shipped: #919 (local CPU) + #1080 (Kyutai streaming adapter) | — |
| 1087 | 14d | CLOSE-fixed | Per-agent MCP grants shipped in PR #1131 | — |
| 1092 | 14d | CLOSE-fixed | Exact-SHA release + atomic tag binding shipped in PR #1105 | — |
| 1093 | 14d | CLOSE-fixed | Hermetic dev-login + dev smoke shipped in PR #1104 | — |
| 1100 | 13d | CLOSE-fixed | Agent Details static inspection shipped via #1176 + #1221 (Agent tab) | — |
| 1121 | 13d | CLOSE-fixed | Tech-watch concluded: copy DO pattern, defer celld, skip Flue (eval done) | — |
| 1184 | 10d | CLOSE-fixed | present-pr generator shipped (#1180); convention adopted | — |
| 1186 | 10d | CLOSE-fixed | Agent-scoped knowledge fs shipped inside agent packages (PR #1202) | — |
| 1195 | 9d | CLOSE-fixed | Tier models load from fleet config since PR #1227 | — |
| 1201 | 9d | CLOSE-fixed | Same fix: MODEL_TIER_CANDIDATES is deployment config since PR #1227 | — |
| 1237 | 7d | CLOSE-fixed | CLI-in-repo (#1302) + symlink-exception removal (#1264) resolved from-source boot; residuals tracked by bead `tm49` | — |
| 1250 | 7d | CLOSE-fixed | ui-review readiness/replay races fixed by #1281–#1294 series | — |

## CLOSE-dup / CLOSE-superseded (4)

| # | Age | Disposition | Reason | Lane |
|---|-----|-------------|--------|------|
| 1197 | 9d | CLOSE-dup-of-1189 | Same defect: instruction links unresolved in CLI hub mode; 1189 is canonical | — |
| 1299 | 5d | CLOSE-dup-of-1304 | Safe artifact links in chat = the 1304 inline-artifact deliverable (PR #1312 in flight) | — |
| 786 | 34d | CLOSE-superseded | Sessionless artifact review queue superseded by factory Inbox on #1187 (PR #1209) | — |
| 979 | 22d | CLOSE-superseded | Gateway native first-send folded into #905/909 execution (`0jpy` beads) | — |

## CLOSE-stale (6)

| # | Age | Disposition | Reason | Lane |
|---|-----|-------------|--------|------|
| 109 | 83d | CLOSE-stale | Pre-rewrite pane-reload bug; 35d untouched, no bead, likely obsolete | — |
| 421 | 51d | CLOSE-stale | Markdown share links idea; 41d untouched, no bead, artifacts cover the need | — |
| 784 | 35d | CLOSE-stale | Two July regressions, unreproduced since, no bead | — |
| 895 | 28d | CLOSE-stale | Session-menu split cosmetic; chrome since reworked (#1252) | — |
| 978 | 22d | CLOSE-stale | Detached-chat/pane-store unification; no bead, landscape changed under 1110 work | — |
| 997 | 20d | CLOSE-stale | Editable skill-source capabilities; no bead, no movement | — |

## PARK (13)

| # | Age | Disposition | Reason | Lane |
|---|-----|-------------|--------|------|
| 790 | 34d | PARK | Layout-state-per-session idea; revisit after Lane A | backlog |
| 819 | 32d | PARK | Observability/metering; plan doc exists (#841), sequenced behind 391 | backlog |
| 848 | 30d | PARK | boring-pi retirement; needs-info, canonical home for pi-packaging asks | backlog |
| 857 | 30d | PARK | Concurrent playground rebuild races; real DX pain, no owner yet | backlog |
| 882 | 29d | PARK | tldraw alternative; idea only | backlog |
| 1083 | 14d | PARK | Playground-on-worktree pane; idea | backlog |
| 1084 | 14d | PARK | Outreach links idea from stale PR #352 | backlog |
| 1094 | 14d | PARK | Questionnaire UX for ask_user; behind 1306/1337 fixes | backlog |
| 1167 | 11d | PARK | LOW-severity cross-tenant nonce sub-budget; SBX audit follow-up | backlog |
| 1210 | 9d | PARK | CH trades epic; plan merged (#1212), bead `nfgt.1` explicitly deferred | vertical |
| 1213–1217 | 9d | PARK | Swiss vertical idea batch (5 issues); label `idea`, revisit with vertical lane | vertical |
| 1224 | 8d | PARK | Batch transcription epic; not started, no bead | backlog |
| 1226 | 8d | PARK | Epic self-marked REWRITE NEEDED; park until rewritten | backlog |
| 1240 | 7d | PARK | Provider-registry refactor; Blaxel (#1236) landed without it — nice-to-have | backlog |

## Counts

- KEEP: 53 (A: 17, B: 10, C: 3, D: 4, 391-program: 12, bugs/owner/other: 7)
- CLOSE-fixed: 16
- CLOSE-dup: 2
- CLOSE-superseded: 2
- CLOSE-stale: 6
- PARK: 17 (counting 1213–1217 individually)
- Total: 97

## Close commands (owner review first — do NOT run blind)

```bash
gh issue close 871  -c "Audit 2026-08-19: review completed and merged in PR #874."
gh issue close 875  -c "Audit 2026-08-19: autoresearch pilot shipped in PR #881."
gh issue close 938  -c "Audit 2026-08-19: package-owned skill resources shipped in PR #970."
gh issue close 1056 -c "Audit 2026-08-19: boundary definitions landed in PR #1057."
gh issue close 1070 -c "Audit 2026-08-19: streaming dictation shipped via PR #919 and PR #1080 (Kyutai adapter)."
gh issue close 1087 -c "Audit 2026-08-19: per-agent MCP grants shipped in PR #1131."
gh issue close 1092 -c "Audit 2026-08-19: exact-SHA release + atomic tag binding shipped in PR #1105."
gh issue close 1093 -c "Audit 2026-08-19: hermetic dev-login + dev smoke shipped in PR #1104."
gh issue close 1100 -c "Audit 2026-08-19: static config inspection shipped via PR #1176 and PR #1221 (Agent tab)."
gh issue close 1121 -c "Audit 2026-08-19: tech-watch concluded — copy Durable-Object pattern, defer celld, skip Flue."
gh issue close 1184 -c "Audit 2026-08-19: present-pr generator shipped in PR #1180; convention adopted for review handovers."
gh issue close 1186 -c "Audit 2026-08-19: agent-scoped knowledge landed inside agent packages (PR #1202)."
gh issue close 1195 -c "Audit 2026-08-19: fixed by PR #1227 — tier models now load from fleet config."
gh issue close 1201 -c "Audit 2026-08-19: fixed by PR #1227 — MODEL_TIER_CANDIDATES is deployment config."
gh issue close 1237 -c "Audit 2026-08-19: resolved by CLI-in-repo (PR #1302) and symlink-exception removal (PR #1264); residuals tracked in bead wt-391-forward-tm49."
gh issue close 1250 -c "Audit 2026-08-19: ui-review readiness/replay races fixed by the PR #1281–#1294 series."
gh issue close 1197 -c "Audit 2026-08-19: duplicate of #1189 (instruction-link resolution in CLI hub mode)."
gh issue close 1299 -c "Audit 2026-08-19: duplicate of #1304 — inline artifact links, PR #1312 in flight."
gh issue close 786  -c "Audit 2026-08-19: superseded by the factory Inbox work on #1187 (PR #1209)."
gh issue close 979  -c "Audit 2026-08-19: superseded — folded into the #905/909 AgentGateway execution beads."
gh issue close 109  -c "Audit 2026-08-19: stale; predates workspace plugin-reload rework, no bead, no repro."
gh issue close 421  -c "Audit 2026-08-19: stale idea; no bead, no movement since July."
gh issue close 784  -c "Audit 2026-08-19: stale; July regressions unreproduced since, no bead. Reopen with fresh repro if seen again."
gh issue close 895  -c "Audit 2026-08-19: stale cosmetic ask; chat chrome since reworked (PR #1252)."
gh issue close 978  -c "Audit 2026-08-19: stale; pane/session landscape changed under the 1110 surface work. Refile if still wanted."
gh issue close 997  -c "Audit 2026-08-19: stale; no bead, no movement since July."
```
