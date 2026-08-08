# STATE — rolling completion tracker

**Last updated: 2026-08-08** (snapshot:
[`state/2026-08-08.md`](state/2026-08-08.md)). Each burn re-dates this file and
adds a dated snapshot under [`state/`](state/); this file holds only the
current status, snapshots hold the analysis. Vision components are defined in
[`VISION.md`](VISION.md); sequencing in [`DIRECTION.md`](DIRECTION.md).

## Vision components — status

| # | Component | Status | Evidence / gap (2026-08-08) |
|---|---|---|---|
| 1 | Environment-independent agent core | **Merged** | AgentGateway v0 + `createAgentHost()` funnel (v0.1.91); D29 still PROPOSED |
| 2 | Multi-fs | **Merged** (base) | #416 bindings; generalized attachments (E1) and executable environments (#1123) not built |
| 3 | Flexible sandbox | **Partial** | bwrap + vercel real; gVisor non-executing; no remote-worker impl; CLI defaults `direct`; no network-egress isolation |
| 4 | External MCP + artifact delivery | **Partial** | User-registered MCP on-ramp merged (#1130/#1131); managed-agent ingress hardcoded off; AR1 artifacts missing |
| 5 | Durable streams / transport | **Partial→merged** | Store wired flagged (#1128/#1141); T2 transport recut missing; stream keying question open |
| 6 | Workspace as control plane | **Partial** | Agents section/fleet cards (#1149), inbox seeds (#1088/#1090); cross-surface sessions + unified approvals missing |
| 7 | Multi-agent EU deployment | **Partial** | Fleet config (#1114), exact-SHA release (#1105); hostname landings (#1154) + default-agent persistence (#1156) in validation; golden-path proof never recorded |
| 8 | EU-sovereign hosting | **Holds** | Exoscale GPU lease (#1126/#1155) |
| 9 | The farm | **Deferred** (by design) | Substrate accumulating; not built as product |

## Epic board — completion

| Epic / lane | Status (2026-08-08) |
|---|---|
| Wave 1 — multi-agent console | **Delivered** (#1102, #1149, #1114, #1143, #1105, #1104); residue: #1147 in validation |
| Wave 2 — streaming durability (#1009) | **Wired** (#1128, #1141); #1142 observability in review |
| Wave 3 — BYOK (#1082/#1010) | **In progress**: vault merged (#1132); persistence #1145 + onboarding #1151 open |
| Wave 3 — external MCP (#1011) | **In progress**: #1130/#1131 merged; #1135 SSRF slice open; then pause pending named consumer |
| Landing lane (D28 presentation-only) | **Validation queue**: #1153 memo, #1154, #1156 |
| Persona packages (#1107) | **Started**: plan merged (#1136); slice 1 (#1150) in review |
| Channels (#1127) | Plan ratified (#1140); zero implementation |
| Executable environments (#1123) | Plan ratified (#1139); zero implementation; weak H1 pull — parked |
| Metering/billing (#819) | **Nothing merged**; H1 needs a minimal metering-facts slice; BL1 billing stays deferred |
| Wave 4 — SBX1 / remote host / marketplace | Frozen behind owner gates (correct) |
| Niche/influencer agents | **Proposed direction** (owner ratification pending) — gap lists in [`state/2026-08-08.md`](state/2026-08-08.md) §5–6 |

## Snapshots

- [`state/2026-08-08.md`](state/2026-08-08.md) — first snapshot: full
  component analysis, lane ranking, paying-customer gaps, GTM readiness,
  niche/influencer gap lists.
