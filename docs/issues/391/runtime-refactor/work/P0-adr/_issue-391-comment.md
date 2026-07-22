> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

P0 pointer update for #391

#391 should use the v2 runtime-refactor pack as the canonical implementation
record:

- Plan-pack entry: `docs/issues/391/runtime-refactor/README.md`
- Ordering authority: `docs/issues/391/runtime-refactor/INDEX.md`
- Locked surface/runtime decisions:
  `docs/issues/391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md`
- Attachable environment detail:
  `docs/issues/391/runtime-refactor/architecture/09-environments-attachable.md`
- Legacy monolith snapshot, preserved for historical context only:
  `docs/issues/391/runtime-refactor/architecture/legacy-monolith-source.md`

The legacy monolith plan is superseded wherever it conflicts with the v2 pack.
The v2 pack ratifies runtime-free, surface-agnostic agents plus the
`@hachej/boring-agent` / `@hachej/boring-bash` /
`@hachej/boring-sandbox` split. The #391 implementation should cite the pack
above, not the legacy monolith, as the source of truth.

Phase set from `INDEX.md`:

- Phase 0 - ADR: `work/P0-adr/`
- Phase 1 - Headless core: `work/P1-headless-core/`
- Phase 2 - boring-sandbox + providers: `work/P2-sandbox-providers/`
- Phase 3 - Routes + tools move: `work/P3-routes-tools/`
- Phase 4 - File UI plugin move: `work/P4-file-ui/`
- Phase 5 - Provisioning / secrets: `work/P5-provisioning-secrets/`
- Phase 6a - Plugin core: `work/P6-plugin-child-app/`
- Phase 6b - Child-app scoping: `work/P6-plugin-child-app/` - blocked on #376 and outside the epic exit gate
- Phase 7 - Multi-agent + inspection: `work/P7-multi-agent-inspection/`
- Phase 8 - Verification + cleanup: `work/P8-verification/`
- Track T1 - Durable events + approvals: `work/T1-durable-events/`
- Track T2 - Transport adapters: `work/T2-transport/`
- Track S1 - Slack channel: `work/S1-slack-channel/`
- Track S2 - Spreadsheet embed: `work/S2-embed-contract/`
- Track S3 - Control-plane UX: `work/S3-control-plane-ux/`
- Track E1 - Environment attachments: `work/E1-environment-attachments/`
- Track E2 - MCP environment projection: `work/E2-mcp-projection/`
- Mount lane X1 - S3/FUSE mounts: `work/X1-s3-fuse-mounts/`

Coverage posture: this abstraction directly owns #391 and materially advances
parts of other issues only when their acceptance criteria land. In particular,
it must not claim unrelated backlog issues are solved merely because the new
runtime/surface spine exists.

The durable decision registry entry for this ratification is
`docs/DECISIONS.md` §19.
