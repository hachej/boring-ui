# P5a minimum provisioning — Handoff checklist

This is the P8 closeout authority. The package `HANDOFF.md` also tracks post-v1
SDK archives, managed services, and the remote-worker attachment/conformance
mount.

## Prerequisites

- [ ] P2 shared provider matrix exists.
- [ ] P3 routes/tools and filesystem UI capability gating are merged.
- [ ] E1 host-owned prepared attachment lifetime is merged.

## V1 beads

- [ ] BBP5-001 — requirement shape and import-free normalizer.
- [ ] BBP5-002 — existing engine/runners move to boring-bash/server; all host
      callers use the normalizer; agent origin/exports are removed.
- [ ] BBP5-003 + BBP5-004 — per-requirement readiness and health gating.
- [ ] BBP5-007 — secret status/grants and host-side brokerage.
- [ ] BBP5-008 — authenticated remote-worker contract/hardening handshake;
      unknown or insufficient runsc/network/limit facts fail closed.
- [ ] BBP5-009 — two-phase fingerprint and on-session reconciliation.
- [ ] BBP5-011 + BBP5-012 — non-dev governance configuration fails closed and
      reports a stable diagnostic.

## Review gates

- [ ] Provider/host/workspace/deployment policy establishes maximum authority;
      authenticated grants/session scope establish active authority;
      requirements only validate it.
- [ ] Declaring `capabilities.secrets` without a grant never grants secret
      access; missing/denied/expired status fails only dependent readiness.
- [ ] Brokered values remain host-side and never reach sandbox env, model,
      browser, plugin, logs, artifacts, or fingerprints.
- [ ] Fingerprints include provider/definition/requirements/attachment facts and
      secret names/status only, never values.
- [ ] Orchestration and prepared-resource lifetime remain host-owned; agent core
      consumes normalized bound inputs.
- [ ] A preconfigured D1 worker proves contract version, runsc systrap,
      per-workspace netns/nftables, metadata/private/cross-workspace denial,
      cgroup/pid/CPU/memory limits, image/persistence facts, and no silent
      downgrade before it is selectable.
- [ ] Worker response identity is authenticated by pinned HTTPS server identity;
      the caller bearer alone is explicitly insufficient. Plaintext, redirect,
      wrong certificate/hostname/fingerprint, and disabled verification reject.

## Exit

- [ ] P5a PRs pr1, pr2, pr3, pr6, pr7, pr8, and the v1 slice of pr9 are merged.
- [ ] P5b SDK/service/remote-worker-mount work remains tracked but is not awaited.
- [ ] No remote-worker attachment-mount generalization, service supervisor, or
      SDK archive is claimed as part of this closeout.
