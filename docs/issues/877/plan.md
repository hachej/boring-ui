---
github: https://github.com/hachej/boring-ui/issues/877
issue: 877
state: ready-for-human
updated: 2026-07-20
flag: not-flaggable
---

# gh-877 safely decommission legacy Fly.io and Neon hosting

## Problem

The self-hosted applications are operational, but the old hosting has not been
fenced or retired:

- `https://boring-full-app.fly.dev` still returns `200` and `{"ok":true}`.
- Fly app `boring-sandbox-worker` still owns an encrypted 10 GB volume named
  `worker_workspace_data`; the daily snapshot workflow is succeeding and
  requesting new snapshots.
- `main` can still deploy `boring-full-app` to Fly from
  `.github/workflows/release.yml` using the repository `FLY_API_TOKEN` secret.
- `.github/workflows/fly-worker-volume-backup.yml` still calls Fly every day.
- Two Neon database URLs remain in Vault under
  `secret/agent/app/boring-ui/{prod,full-app-dev}`.
- The Neon `prod` database received application activity on 2026-07-20, well
  after the documented 2026-06-26 OVH cutover.

Deleting the provider resources now would save cost, but it would also destroy
an active old endpoint, provider snapshots, and data that is not fully present
in either self-hosted database. The safe objective is therefore to stop compute
cost quickly through a reversible fence, retain verified recovery artifacts,
and perform permanent deletion only after the data and traffic gates pass.

## Current Evidence

Evidence was collected read-only on 2026-07-20. Secret values and application
content were not printed.

### Self-hosted replacements

| Replacement | Evidence | Status |
| --- | --- | --- |
| Seneca | `prod.senecaapp.ai` Cloudflare and direct-origin health pass; exact image `ee161b34bf75511429522649fc4e975494a8d839`; email verification/auth/workspace/Pi/Infomaniak E2E passes; PostgreSQL 17 checksums, WAL, encrypted backup, isolated restore, and monitor proof pass | Green |
| Constellation | `constellation.senecaapp.ai/health` returns 200; recent Post Deploy Smoke runs pass; app uses native PostgreSQL 17 `boring_full_app` at the OVH DB VM, not Neon; ownership issue #25 and PR #26 are merged | Green, but live canonical backup/Vault continuity and an independently usable restore must still be recorded before deleting Neon `prod` as a recovery source |

### Legacy Fly resources

| Resource | Evidence | Risk |
| --- | --- | --- |
| `boring-full-app` | Public Fly hostname is live; config declares one always-running public service, `workspace_data` mount, and DB migration release command | Can still receive traffic and write to Neon |
| `boring-sandbox-worker` | Internal worker config declares a 2 GB VM and `worker_workspace_data` mount | May contain workspace files not held in PostgreSQL |
| Worker volume | Daily run `29721597260` reported encrypted volume `vol_42k0271392690g84`, 10 GB, `cdg`, scheduled snapshots, 14-day retention, and 29 snapshots | Provider snapshots may disappear with app/volume deletion |
| Deploy credentials | `hachej/boring-ui` repository secret `FLY_API_TOKEN` exists | A future release can redeploy until the workflow is fenced |
| Local operator access | Local Fly config has no usable access token | This Fly inventory is provisional and derived from repository config plus a successful live snapshot run. Exact live machine/app inventory needs an owner-authorized Fly session or a narrowly scoped read-only inventory workflow; no downstream fence or deletion manifest is valid until that inventory exists. |

### Legacy Neon data

There are two distinct databases; they must not be treated as one migration.

| Vault owner path | Safe inventory | Relationship to replacements |
| --- | --- | --- |
| `boring-ui/prod` | PostgreSQL 17, about 14 MB, 3 users, 4 workspaces, 106 usage-ledger rows, 49 usage reservations, 13,036 telemetry rows | All 3 users, all 4 workspaces, all 3 accounts, both credit grants, and all 3 runtime resources exist in Constellation. However, only 75/106 usage-ledger rows, 25/49 reservations, 0/1 sessions, and 5,425/13,036 telemetry rows exist there. This is not a complete row-level migration. |
| `boring-ui/full-app-dev` | PostgreSQL 17, about 9 MB, 2 users, 3 workspaces | None of its user, workspace, account, grant, ledger, reservation, session, or runtime-resource identities are present in Seneca. It is a separate legacy dataset, not the Seneca self-host source. |

Every source-only set is a hard gate: 31 usage-ledger rows, 24 reservations,
one session, and 7,611 telemetry rows in Neon `prod`, plus the entire
`full-app-dev` dataset. They may be harmless post-cutover test activity, but that
requires an owner decision after a redacted reconciliation report. Credit/usage
records must not be silently merged because they have accounting semantics and
may collide with target state. The source of the 2026-07-20 writes is not yet
identified; writer attribution is required before any credential is fenced.

## Solution

Use a five-stage decommission with an irreversible owner gate:

1. **Inventory and preserve** every Fly/Neon resource and create restorable,
   encrypted provider-independent archives.
2. **Fence redeployment and writers**, then scale Fly compute to zero while
   keeping apps, volumes, and Neon projects available for rollback.
3. **Observe and reconcile** traffic and data through the longest applicable
   retry/session window, with seven days as an absolute minimum unless waived.
4. **Approve permanent deletion** with a signed manifest identifying exactly
   what will be destroyed and what remains retained.
5. **Delete, revoke, and verify billing**, retaining proof for the agreed period.

This sequencing stops most compute cost at stage 2 without prematurely deleting
data. Neon endpoint autosuspend/minimum-compute settings and plan/add-on costs
must be recorded rather than merely assuming autosuspend; projects remain only
during the cool-off and archive-verification window.

## Decisions

1. **Do not couple this to Seneca availability.** Seneca is already green and
   does not use either legacy Neon dataset. Its app, DB, R2 repository, Vault
   path, and GitHub production environment are out of scope for deletion.
2. **Constellation is the successor for Neon `prod`.** Identity overlap and
   current runtime configuration support this mapping. This does not imply that
   every post-cutover legacy write should be copied.
3. **Treat `full-app-dev` as archive-before-discard.** No target contains its
   identities. Default action is an encrypted final dump retained for 90 days,
   unless the owner requests import or a longer retention period.
4. **Never merge legacy rows automatically.** Produce a report of every
   source-only row set, creation windows, state/status, referential closure, and
   aggregate non-PII amounts. The owner chooses discard-as-test-data, targeted
   replay, or longer archival retention for ledger, reservation, session,
   telemetry, and `full-app-dev` data.
5. **Fence before delete.** Remove every deploy path, quiesce writers, capture
   post-fence final artifacts, then scale Machines to zero. Permanent
   app/project deletion occurs only after the observation gate.
6. **Provider snapshots are not the durable archive.** Export Fly volume content
   to independently owned encrypted storage and prove extraction before deleting
   the Fly apps.
7. **Preserve cryptographic continuity.** Do not remove `session_secret`,
   `settings_key`, backup cipher material, or any shared encryption value from
   the old Vault path until the canonical Constellation path has the required
   value and existing encrypted records have been read successfully.
8. **No account closure in the first pass.** Delete billable resources and revoke
   scoped tokens, but retain provider account access long enough to retrieve
   invoices/audit records and verify two subsequent billing statements.
9. **Two approvals for irreversible operations.** The executor and owner must
   both approve the final deletion manifest. The same person must not silently
   invent an N/A for an unmatched dataset.
10. **PR #853 must preserve recovery until this plan proves replacement
    archives.** Its removal of the Fly snapshot workflow is now gated on #877's
    volume archive and isolated extraction proof. Issue #877 can remove the
    Fly/Neon blocker from #853, but cannot claim to satisfy Constellation-owned
    operational evidence.

## Flag / Abstraction

- Needed?: Not flaggable. Provider destruction and credential revocation are
  operational actions outside the application runtime.
- Path: Reversibility comes from staged fencing, zero Machines, retained apps and
  volumes, encrypted dumps, exported volume content, and a dated hold period.
- Rollback before deletion: restore Fly Machines from a provider-independent
  retained image digest/artifact, complete Machine config, verified secret
  sources, role-recreation procedure, and retained volumes; restore Neon
  connectivity with an owner recovery role. The application release migration
  must remain disabled during rollback until DB compatibility is checked.
- Rollback after deletion: restore PostgreSQL 17 from the verified dump and Fly
  filesystem data from the independent archive into a self-hosted recovery
  environment. Provider-specific snapshots are not assumed to survive.
- Proposed objective for owner approval: pre-deletion rollback RTO <= 4 hours;
  post-deletion archive recovery RTO <= 8 hours; RPO is the recorded final
  post-fence watermark. No post-fence legacy writes are accepted.

## Preconditions and Human Decisions

The issue stays `ready-for-human` until these are answered in writing:

1. Are the two `full-app-dev` users and three workspaces known disposable test
   data? If uncertain, use the default 90-day encrypted archive and do not import.
2. For every source-only Neon `prod` set—ledger, reservations, session, and
   telemetry—choose one:
   - discard as obsolete test activity after reviewing the aggregate report;
   - replay a reviewed subset into Constellation through a one-off migration;
   - preserve only in the archive for the retention period.
3. Approve the cool-off duration. Default is the later of seven full days, the
   longest external callback/retry window, and expiry of known active legacy
   sessions (current evidence reaches 2026-08-19). A shorter window requires an
   explicit waiver that recent old-endpoint activity may represent a user who
   has not moved.
4. Identify the archive owner and durable destination. It must not be the Fly
   volume or Neon project being deleted. Cloudflare R2 is acceptable only with a
   dedicated prefix/bucket, encryption, retention, and independently retained
   decryption material.
5. Provide owner-authorized Fly API access for inventory/execution. Do not expose
   the token in chat or logs; use Vault or a protected GitHub environment.
6. Identify the source of every post-cutover Neon `prod` write by role,
   connection/application metadata, timestamp, and available provider logs.
   Unattributed writes block credential fencing.
7. Confirm live Constellation pgBackRest/WAL/Vault ownership and an independently
   usable restore before Neon `prod` can be permanently deleted.

## Stage 1 — Inventory and Preserve

### Fly inventory

With an owner-authorized token, capture machine-readable output and redact secret
values:

```bash
flyctl apps list --json
flyctl status --app boring-full-app --json
flyctl machines list --app boring-full-app --json
flyctl volumes list --app boring-full-app --json
flyctl ips list --app boring-full-app --json
flyctl certs list --app boring-full-app --json
flyctl secrets list --app boring-full-app --json

flyctl status --app boring-sandbox-worker --json
flyctl machines list --app boring-sandbox-worker --json
flyctl volumes list --app boring-sandbox-worker --json
flyctl volumes snapshots list vol_42k0271392690g84 \
  --app boring-sandbox-worker --json
flyctl secrets list --app boring-sandbox-worker --json
```

Also record organization, regions, complete Machine configs and volume mappings,
image references/digests and an independently retainable image artifact, process
counts, autostart/autostop settings, custom domains, dedicated IPs, certificates,
add-ons, current monthly cost, and the maximum observed traffic/retry window.
Record the authoritative source for every app/worker secret by name without
exporting values. Store the redacted inventory with the issue proof bundle.

### Fly volume export

1. Create a preliminary archive from the newest healthy provider snapshot before
   any fence. This protects against failure during quiescing but is not the final
   artifact.
2. Materialize that snapshot on a temporary recovery volume. Never archive a
   live read-write mount; use snapshot materialization or a demonstrably quiesced
   worker.
3. Create a deterministic archive of `/data`, preserving ownership, modes,
   symlinks, and timestamps.
4. Encrypt client-side before upload. Record algorithm/key owner, object URI,
   byte size, and SHA-256 of the encrypted object and plaintext archive manifest.
5. On a disposable machine, decrypt and list/extract the archive; compare file
   count, total bytes, and a sorted per-file checksum manifest.
6. During Stage 2, after application/worker writers are quiesced, repeat the
   snapshot, export, extraction, and comparison. Only this post-quiesce artifact
   is marked final.
7. Remove temporary recovery machines/volumes only after proof is recorded.

Do this for both `worker_workspace_data` and any `workspace_data` volume found on
`boring-full-app`. Discovery, not repository assumptions, decides the final list.

### Neon inventory and preliminary dumps

Inventory every project, branch, endpoint/pooler, database, role, integration,
and paid feature in the owning Neon accounts. The two Vault URLs are entry
points, not proof that a whole project is exclusive to this application.

For both Vault database URLs, take preliminary safety dumps:

```bash
pg_dump --format=custom --no-owner --no-privileges \
  "$DATABASE_URL" > "<dataset>-preliminary.dump"
sha256sum "<dataset>-preliminary.dump"
pg_restore --list "<dataset>-preliminary.dump" \
  > "<dataset>-preliminary.list"
```

Capture project, branch, endpoint, region, PostgreSQL version, compute state,
autosuspend/minimum-compute settings, plan/support/integration cost,
PITR/retention, roles/grants by name, extensions, schema-only dump, table counts,
sequence values, and latest non-content timestamps. `pg_dump` may briefly resume
an autosuspended endpoint; record that expected read-only wake-up separately from
application writes. Do not commit connection strings or row content.

Encrypt each dump before it leaves the operator machine. Restore each onto a
disposable PostgreSQL 17 instance with networking disabled or tightly isolated.
Proof requires:

- `pg_restore` success;
- schema/table/sequence comparison;
- exact row counts;
- representative read-only application queries;
- archive SHA-256 verification;
- a recorded restore command, duration, and cleanup result.

### Reconciliation report

Compare old Neon `prod` to Constellation at one recorded consistent cutoff.
Use stable IDs where migration preserved them, and validate that assumption with
natural/business keys and mutable-column hashes. Include schema differences,
source-only/target-only IDs, foreign-key closure, sequence positions, and every
common table. For every source-only set—including ledger, reservations, session,
and telemetry—report only:

- table and count;
- minimum/maximum creation time;
- state/status breakdown;
- aggregate units/amounts where non-sensitive;
- whether referenced user/workspace IDs exist in Constellation;
- natural-key match and mutable-column hash result where applicable.

No mutation follows automatically. Owner approval chooses discard, replay, or
archive-only for each source-only set. If replay is selected, create a separate
migration issue/PR with idempotency, foreign-key ordering, dry-run, rollback, and
audit proof. Repeat reconciliation against the post-fence final dump; the
preliminary report cannot authorize deletion.

## Stage 2 — Fence, Capture Final Artifacts, and Stop Compute Cost

Execute in this order:

1. Freeze unrelated hosting changes and record final Fly logs/metrics and Neon
   activity watermarks.
2. Identify the source of all post-cutover Neon writes. Writer role, connection
   metadata, application, and purpose must be understood before revocation.
3. Land a small guardrail PR before scaling anything:
   - remove the Fly deploy job from `.github/workflows/release.yml`;
   - require explicit `E2E_TARGET_URL` and `E2E_DATABASE_URL` in
     `apps/full-app/e2e/auth-lifecycle.spec.ts` and the Seneca copy;
   - tombstone active Fly instructions in `README.md`, `apps/full-app/README.md`,
     `docs/credits-prod-deployment.md`, worker backup docs, scripts,
     `.github/workflows/post-deploy-smoke.yml` examples, and related examples;
   - add an invariant that rejects operational workflows/scripts referencing
     `flyctl`, `FLY_API_TOKEN`, Fly deployment/snapshotting, or Neon URLs.
4. Keep `.github/workflows/fly-worker-volume-backup.yml` active only until the
   post-quiesce final volume archive and isolated extraction pass. PR #853 must
   not merge away this workflow before that #877 proof; record this as an
   explicit #853 merge gate. The guardrail PR must not wait for broader cleanup.
5. Quiesce old application and worker writers and disable autostart. Do not deploy
   a new 410 image or mutate the pinned rollback image.
6. While quiesced, create final snapshots for every volume, materialize them on
   controlled temporary recovery Machines, export encrypted archives, and repeat
   the extraction/checksum proof. Remove recovery Machines after proof.
7. Set `boring-full-app` and `boring-sandbox-worker` to a declared zero Machine
   count while retaining apps and volumes. Record exact IDs and prove a direct
   request cannot auto-start a Machine.
8. Fence Neon application roles: revoke login/connect as appropriate, terminate
   existing application sessions, and preserve only a separately controlled
   recovery role plus documented role-recreation SQL.
9. After all writers are fenced, repeat `pg_dump` as
   `<dataset>-final-<UTC>.dump`, hash and encrypt it, capture schema and sequence
   inventories, restore both dumps in isolation, and rerun complete
   reconciliation against this final cutoff. Stage 1 dumps remain preliminary.
10. Remove the repository `FLY_API_TOKEN` secret and revoke its dedicated
    automation token before observation. Create a separate short-lived,
    least-privilege operator credential for final inventory/deletion and keep it
    out of repository automation.
11. Disable the Fly snapshot workflow after final volume archive proof, and
    verify both Neon databases remain write-idle with endpoint compute at the
    intended suspended/minimum setting.

A direct request to `boring-full-app.fly.dev` after fencing must not start an old
Machine or create a Neon row. Do not redirect authenticated or write requests
between applications with different session/data semantics.

## Stage 3 — Observe

Observation starts only after post-fence final archives, restores, and
reconciliation pass. The window is at least seven full days and no shorter than
the longest webhook/email/OAuth/client retry or known active legacy session
lifetime unless the owner signs a narrower waiver. Current session evidence
extends to 2026-08-19. Collect continuous alerts/counters plus daily attestations:

- Seneca public/direct health, exact deployed image, full critical-path E2E, and
  backup monitor status;
- Constellation public health, post-deploy smoke, application DB connectivity,
  latest pgBackRest full/differential status, WAL queue, and isolated restore
  ownership evidence;
- Fly machine counts remain zero and continuous monitoring shows no unexpected
  Machine start; distinguish scanners from authenticated/legitimate traffic;
- Neon transaction/activity counters and latest application timestamps do not
  advance, except explicitly tagged read-only audit sessions;
- Cloudflare DNS, OAuth callback lists, email links, CORS/auth URLs, webhooks,
  monitoring, status pages, and documentation contain no required Fly endpoint;
- no GitHub workflow, local script, or release path can deploy or snapshot Fly;
- no operator reports a missing legacy account/workspace.

Any unexpected write, traffic source, callback, or user report resets the window
and blocks permanent deletion.

## Stage 4 — Irreversible Approval and Deletion

Create a provider-validated resource graph and ID-specific command manifest with
exact resource IDs and checkboxes. A Vault URL is not proof that a Neon project
is exclusive. The manifest must include:

- Fly organization, both apps, every Machine, volume, snapshot, IP, certificate,
  add-on, and token to remove;
- both Neon project/branch/endpoint IDs and roles to remove;
- archive URIs, hashes, retention expiry, decryption owner, and restore proof;
- last activity/watermark and observation-window evidence;
- expected monthly savings;
- executor and owner approvals with UTC timestamps.

After approval, execute the exact reviewed commands in this conservative order,
adjusted only if current provider documentation requires a safer dependency:

1. Verify Seneca and Constellation health/backups once more. Neon `prod` deletion
   is blocked until live Constellation pgBackRest/WAL/Vault continuity and an
   independently usable restore are recorded.
2. Remove confirmed-unused external callbacks, custom DNS mappings, integrations,
   and add-ons; verify no unrelated project shares them.
3. Verify Fly Machine counts remain zero; release app-scoped certificates and
   dedicated IPs.
4. Delete detached Fly volumes and verify provider-snapshot disposition against
   the independently restored archives.
5. Destroy `boring-sandbox-worker`, then `boring-full-app`; verify both apps and
   hostnames are absent.
6. For each proven-exclusive Neon project, terminate residual sessions and revoke
   app access, delete endpoints/poolers, delete non-default branches, then delete
   the project/default branch using provider-supported semantics.
7. Verify resource absence and an immediate zero-resource billing inventory
   before revoking the short-lived deletion credential.
8. Remove or tombstone obsolete Vault fields (`database_url`, `neon_*`) only
   after required session/settings keys have moved to canonical owner paths.
   Tombstones must contain no old credential values.
9. Remove local Fly/Neon cached credentials and stale CI environment entries.
10. Run repository secret/name/reference scans and confirm no live operational
    document tells an operator to deploy Fly or connect to Neon.

## Stage 5 — Billing and Retention Closure

- Export the final Fly and Neon invoices/resource-cost views before deletion,
  including endpoint minimum compute/autosuspend, plans/support/integrations,
  volumes, snapshots, IPs, branches, and PITR storage.
- Verify an immediate post-deletion zero-resource billing inventory.
- Check the next two billing statements for orphaned storage, IPs, snapshots,
  compute, branches, support, or add-ons.
- Keep encrypted archives and the deletion proof bundle for the approved
  retention period; default 90 days for `full-app-dev` and legacy Fly volumes.
- At expiry, require a separate owner approval before deleting the archives.
- Close provider accounts only if no other organization project, invoice, audit
  log, or retained recovery procedure depends on them.

## Test Seams

- Highest public seam: public health and complete user critical-path E2E against
  `prod.senecaapp.ai` and `constellation.senecaapp.ai`.
- Database seam: one-cutoff stable-ID plus natural-key/mutable-hash
  reconciliation, FK/sequence checks, final dump hash, and isolated PostgreSQL 17
  restore.
- Filesystem seam: encrypted archive restore plus sorted metadata/checksum
  manifest comparison.
- Automation seam: repository invariant that operational workflows/scripts
  cannot invoke `flyctl`, use `FLY_API_TOKEN`, deploy/snapshot Fly, or depend on
  Neon URLs.
- Provider seam: zero-Machine/zero-writer inventory during cool-off, then
  resource-not-found checks after deletion.
- Billing seam: two post-deletion invoices with no legacy resource charges.
- Avoid testing: never run write tests against legacy production after the final
  watermark; never print connection strings, Fly tokens, auth/session keys, or
  user data into CI logs or issue comments.

## Acceptance

- [ ] Owner classified `full-app-dev` data and every source-only Neon `prod` set
      (ledger, reservations, session, telemetry) as replay, archive-only, or
      approved discard.
- [ ] Every post-cutover Neon writer is attributed before it is fenced.
- [ ] Exact, exclusive Fly and Neon resource graphs are captured with no secret
      values.
- [ ] Every Fly volume has a post-quiesce independently stored encrypted archive
      and proven extraction/checksum manifest.
- [ ] Both Neon datasets have post-fence encrypted final dumps, successful
      isolated PostgreSQL 17 restores, and complete final reconciliation.
- [ ] Release/E2E/snapshot automation cannot recreate or silently use Fly.
- [ ] Fly has zero Machines and Neon has no application writers for the approved
      observation window.
- [ ] Seneca remains healthy with current backup/restore proof.
- [ ] Constellation has live pgBackRest/WAL/Vault continuity and independently
      usable restore proof before Neon `prod` deletion.
- [ ] PR #853 has not removed the Fly snapshot workflow before #877's final
      volume archive/extraction proof.
- [ ] Owner approved the exact irreversible deletion manifest.
- [ ] Fly apps/volumes/IPs/certs/add-ons and Neon endpoints/branches/projects are
      absent after execution.
- [ ] Obsolete provider and CI credentials are revoked; required encryption and
      backup keys remain in canonical owner paths.
- [ ] Two subsequent invoices show no legacy Fly/Neon resource charges.

## Proof

- Exact command: provider inventory commands and redacted JSON attached to issue
  #877 or an owner-controlled evidence store.
- Exact command: `pg_dump`, `sha256sum`, `pg_restore --list`, isolated
  `pg_restore`, schema/count/sequence comparison for each Neon dataset.
- Exact command: encrypted Fly archive extraction and sorted checksum comparison.
- Exact command: repository CI invariant and targeted workflow/reference scans.
- Manual steps: continuous counters plus daily zero-machine/zero-writer evidence
  for the approved retry/session observation window and external health/E2E
  checks.
- Manual steps: final deletion manifest, provider resource-not-found checks, and
  before/after billing exports.
- Waiver: none for provider-independent data archives, restore proof, or owner
  approval. A shorter observation period is allowed only with explicit residual
  risk acceptance.

## Slices

### Slice 1: Inventory, archives, and data decision

**Delivers:** Exact provider inventory; preliminary encrypted/restored Neon dumps
and Fly volume archives; redacted complete reconciliation report; writer
attribution; owner data classification and archive destination.

**Blocked by:** Owner-authorized Fly access and archive destination/retention
owner.

**Proof:** Inventory JSON, hashes, restore transcripts, checksum manifests, and
written data decision.

**Review budget:** Exceeds a normal code review because it includes live-provider
and data evidence; requires independent operator review.

### Slice 2: Automation guardrails and reversible fence

**Delivers:** PR preventing Fly redeploy/default test traffic and tombstoning
active instructions; quiesced post-fence final volume/DB artifacts with restore
proof; worker snapshot job retired; repository automation token revoked; Fly zero
Machines; Neon sessions terminated and application writers fenced.

**Blocked by:** Slice 1.

**Proof:** Green CI, broad invariant output, final archive hashes/restores,
zero-machine inventory, final reconciliation, role/session fence evidence, and
unchanged Neon watermark after controlled read-only verification.

**Review budget:** Inside one code PR plus a separately approved operator run.

### Slice 3: Observation and final approval

**Delivers:** Continuous/daily evidence through the approved retry/session window,
current self-host backup proof, provider-validated ID-specific deletion command
manifest, and two-person approval.

**Blocked by:** Slice 2.

**Proof:** Dated health/E2E/backup/traffic/write-idle evidence and signed manifest.

**Review budget:** Operational review; no code change required.

### Slice 4: Permanent deletion, revocation, and billing closure

**Delivers:** Provider resources deleted, credentials revoked, stale metadata
removed/tombstoned, #853 no longer blocked by legacy Fly/Neon existence, and
billing verification scheduled. Constellation-owned proof remains independent.

**Blocked by:** Slice 3 owner approval.

**Proof:** Resource-not-found responses, secret-name inventory, reference scans,
final invoices, and retained archive manifest.

**Review budget:** Destructive operator change requiring live supervision and a
post-operation independent audit.

## Out of Scope

- Decommissioning either OVH App/DB pair.
- Deleting Seneca or Constellation R2/pgBackRest repositories, Vault credentials,
  DNS records, images, or current GitHub deployment secrets.
- Removing Vercel Sandbox; it remains part of Seneca's current runtime.
- Merging legacy user/data sets without a separate reviewed migration plan.
- Closing a Fly or Neon account that may contain unrelated projects.
- The separate `packages/pi` consolidation decision.

## Open Questions

1. Are `full-app-dev`'s two users/three workspaces disposable tests, or should the
   archive be retained longer than 90 days?
2. Are the 31 unmatched usage-ledger rows, 24 unmatched reservations, one
   session, and 7,611 telemetry rows in Neon `prod` disposable post-cutover test
   activity, or do any require audited replay?
3. May permanent deletion occur before the current legacy session expiry on
   2026-08-19? If yes, what narrower window and residual-risk waiver is approved?
4. Which owner-controlled destination and key custodian will hold encrypted Neon
   dumps and Fly filesystem archives?
5. Who will provide/operate the Fly token for inventory and deletion, and who is
   the second approver for the irreversible manifest?
6. Which client/application produced the post-cutover Neon writes, and are any
   external callbacks or users still intentionally using the Fly endpoint?
7. Are the proposed rollback objectives (4-hour pre-deletion, 8-hour archive
   recovery, RPO at final fence) acceptable?
