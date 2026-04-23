# Known Limitations

## Abandoned Vercel sandboxes (xzr)

`@boring/agent` v1 intentionally does **not** implement a session-close release hook.
If a process crashes or a client disappears before cleanup, the sandbox may remain
alive until Vercel timeout/TTL.

### Failure modes that can orphan a sandbox

- Backend crash or `kill -9` before cleanup path runs.
- Cross-process/session abort where the owning process never executes `stop()`.
- Browser tab close/network drop where `beforeunload` is unreliable.
- Multi-process deployments where one worker creates sandboxes and a different
  worker handles later traffic.

### Cost exposure (from `4vl` model)

See [VERCEL_COSTS.md](./VERCEL_COSTS.md) for full assumptions.

| Policy / behavior | Estimated cost per workspace per day |
|---|---:|
| Stop on session end | `$0.0822` |
| Idle-stop after 60 min | `$0.1246` |
| No explicit stop (5h timeout) | `$0.4638` |
| Pinned 24h workspace | `$2.0750` |

Implication: memory wall-clock billing dominates. Orphans are tolerable at low
volume but become expensive if idle lifetimes grow.

### v1 monitoring + operations guidance

- Set Vercel spend/budget alerts on the team account (monthly threshold chosen
  by owner; start low and tighten with observed traffic).
- Use `[sandbox]` logs for daily create/stop drift checks.
  - Create log: `"[sandbox] created"` with `workspaceId`, `sandboxId`,
    `estimatedAbandonedSessionCostUsd`.
  - Stop log (orphan guard): `"[sandbox] stopped"` with
    `reason: "orphan-guard-idle"`.
- Compare create vs stop counts in logs:

```bash
grep -c "\\[sandbox\\] created" /var/log/boring-agent.log
grep -c "\\[sandbox\\] stopped" /var/log/boring-agent.log
```

- Manual cleanup workflow:

```bash
vercel sandbox list --team <team-id>
vercel sandbox stop <sandbox-id> --team <team-id>
```

### Trigger to build full mitigation

Implement release-on-close lifecycle when either trigger is hit:

1. First user reports unexpected Vercel bill attributable to orphaned sandboxes.
2. Monitoring shows `> 10` apparently abandoned sandboxes at peak.

### Pre-designed mitigation path (deferred)

1. Browser `beforeunload` best-effort call to release endpoint.
2. Backend idle timer (`~10 min`) that calls `sandbox.stop()` when no traffic.
3. Explicit CLI/server flag for forced idle-stop policy.

v1 status: **accepted risk**, documented and monitored.

## GitHub Connect + `/api/v1/git/*` deferred to v1.x (nfx)

Git HTTP routes are intentionally not shipped in v1. Both `@boring/agent` v1
and `@boring/workspace` v1 dropped git UI consumers, so `/api/v1/git/*` would
be dead code today.

### Current v1 behavior

- Git operations run through the existing `bash` tool (`git status`, `git add`,
  `git commit`, etc.).
- No GitHub Connect token flow is wired into agent HTTP routes yet.

### Why this is deferred

- No first-party UI consumer exists yet (status bar, diff pane, git badges).
- The design is non-trivial enough to avoid shipping unused backend surface.
- Deferring keeps v1 smaller while preserving a clear activation path.

### Planned migration path once a consumer lands

1. Add `/api/v1/git/*` thin wrappers over `sandbox.exec('git ...')` with output
   parsing.
2. Add GitHub Connect credential injection for remote mode
   (`https://x-access-token:$TOKEN@github.com/...`).
3. Emit `data-git-changed` SSE invalidation events after write operations.
4. Seed git config (`user.name`, `user.email`) when a sandbox workspace is
   created.

### Trigger to implement

Ship when any UI consumer lands (agent v1.x git status/diff UI, or workspace
reintroducing git badges/panels).
