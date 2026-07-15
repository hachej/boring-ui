# D1-006 core proof and offline recovery

This runbook proves one D1 core revision serving three exact bindings, additive
N+1 continuity, exact rollback, and an offline disaster restore. It is
operator-only. It does not attest the host release, Caddyfile, core environment,
security configuration, or migration set; those remain behind
`wt-391-forward-tz4`.

The commands intentionally use operator-defined variables instead of recording
host locations, customer hostnames, credentials, cookies, or secret values.
Run with shell tracing disabled and `umask 077`. Attach only the final redacted
report and command pass/fail summary to the PR.

## Preconditions

- The three- and four-binding plans use the same immutable core image and the
  same host/runtime/database/root policies. The fourth binding is new and has
  never been admitted.
- Three existing members and one non-member test principal are available.
- The `docker-runsc-nonroot` profile is registered. `verify-live` reruns the
  `wt-391-forward-iku` hostile suite; a committed evidence JSON is not accepted
  as live proof.
- The D1 revision CLI environment is already installed per the deployment
  procedure. Put host-specific locations and auth material only in the
  operator's protected environment or credential files.
- PostgreSQL, workspace, session, and D1 state backups use encrypted off-host
  storage. Secret values use the separate approved encrypted secret channel and
  never enter this proof.

Prepare a private evidence directory and build the checked-out revision:

```sh
set +x
umask 077
test -n "$BORING_D1_HOST_ID"
test -n "$BORING_D1_OWNER_UID"
test -n "$D1_PROOF_DIR"
pnpm run build:packages
pnpm -C apps/full-app typecheck
```

## Three bindings and pre-effect authority

Start the timer immediately before the three-binding apply. Feed plans only on
stdin; the CLI emits a single redacted result.

```sh
D1_STARTED_AT="$(date +%s)"
pnpm -C apps/full-app d1:revision < "$D1_PLAN_THREE" > "$D1_PROOF_DIR/apply-three.json"
pnpm -C apps/full-app proof:d1-core capture > "$D1_PROOF_DIR/initial-envelope.json"
jq -e '.ok == true and (.snapshot.bindings | length == 3)' "$D1_PROOF_DIR/initial-envelope.json" >/dev/null
jq '.snapshot' "$D1_PROOF_DIR/initial-envelope.json" > "$D1_PROOF_DIR/initial.json"
```

For each hostname, prove landing, same-origin sign-in, the one bound workspace,
and its server-side `default` resolved digest. Do not save response bodies. Save
only status/code, effect count, admission count, and the redacted resolved
digest. Use the normal prompt endpoint for the member effect:

```text
POST /api/v1/agent/pi-chat/{sessionId}/prompt
GET  /api/v1/agent/pi-chat/{sessionId}/state
GET  /api/v1/workspaces
```

Run the member request first. It must complete one effect and append one
admission row. Record the admission row's committed timestamp and the first
durable effect's started timestamp in UTC milliseconds; the admission timestamp
must be earlier. Then run:

1. the non-member against that hostname; expect `403 not_member`;
2. the member with a foreign workspace selector; expect
   `421 D1_HOST_SCOPE_VIOLATION`.

For each denial, compare the PostgreSQL admission count and the durable session
manifest before and after. Both must be unchanged. Record the chained counters
in one binding-scoped authorization entry. Sort the three entries by binding id;
each names a different initial binding as `crossBindingId`. The verifier requires
one entry for every initial binding, the allowed transition to be `+1/+1`, and
both denials to be `+0/+0`.

Stop the setup-to-first-success timer when the first member turn becomes
durably readable. Record the contiguous `apply-three` and `first-success`
stages with UTC-millisecond `startedAt`/`completedAt` boundaries and positive
durations derived from those boundaries. Their sum and the outer interval must
equal `totalSeconds`. `900` seconds is recorded as the target; exceeding it does
not fail verification.

## N+1 without restart

Record a digest of the core container identity and its restart count. Start a
member turn on one initial binding and keep polling its state while applying the
four-binding plan.

```sh
D1_CORE_PROCESS_BEFORE="sha256:$(docker inspect --format '{{.Id}}:{{.State.StartedAt}}' "$D1_CORE_CONTAINER" | sha256sum | cut -d' ' -f1)"
D1_RESTARTS_BEFORE="$(docker inspect --format '{{.RestartCount}}' "$D1_CORE_CONTAINER")"
D1_INGRESS_PROCESS_BEFORE="sha256:$(docker inspect --format '{{.Id}}:{{.State.StartedAt}}' "$D1_INGRESS_CONTAINER" | sha256sum | cut -d' ' -f1)"
D1_INGRESS_RESTARTS_BEFORE="$(docker inspect --format '{{.RestartCount}}' "$D1_INGRESS_CONTAINER")"
pnpm -C apps/full-app d1:revision < "$D1_PLAN_FOUR" > "$D1_PROOF_DIR/apply-four.json"
pnpm -C apps/full-app proof:d1-core capture > "$D1_PROOF_DIR/n-plus-one-envelope.json"
jq -e '.ok == true and (.snapshot.bindings | length == 4)' "$D1_PROOF_DIR/n-plus-one-envelope.json" >/dev/null
jq '.snapshot' "$D1_PROOF_DIR/n-plus-one-envelope.json" > "$D1_PROOF_DIR/n-plus-one.json"
D1_CORE_PROCESS_AFTER="sha256:$(docker inspect --format '{{.Id}}:{{.State.StartedAt}}' "$D1_CORE_CONTAINER" | sha256sum | cut -d' ' -f1)"
D1_RESTARTS_AFTER="$(docker inspect --format '{{.RestartCount}}' "$D1_CORE_CONTAINER")"
D1_INGRESS_PROCESS_AFTER="sha256:$(docker inspect --format '{{.Id}}:{{.State.StartedAt}}' "$D1_INGRESS_CONTAINER" | sha256sum | cut -d' ' -f1)"
D1_INGRESS_RESTARTS_AFTER="$(docker inspect --format '{{.RestartCount}}' "$D1_INGRESS_CONTAINER")"
test "$D1_CORE_PROCESS_BEFORE" = "$D1_CORE_PROCESS_AFTER"
test "$D1_RESTARTS_BEFORE" = "$D1_RESTARTS_AFTER"
test "$D1_INGRESS_PROCESS_BEFORE" = "$D1_INGRESS_PROCESS_AFTER"
test "$D1_INGRESS_RESTARTS_BEFORE" = "$D1_INGRESS_RESTARTS_AFTER"
```

The in-flight turn must finish, and a fresh state/read request must resolve the
same retained binding digest. Record zero core/ingress start or restart events
for the apply window. The verifier compares every retained binding identity
byte-for-byte and requires exactly one addition. Each captured binding also
names the `runsc` runtime profile, its content digest, and the isolation
attestation digest; the last must equal the accepted live isolation evidence
digest for every initial, added, and rollback binding.

## Exact rollback

Confirm in PostgreSQL that the fourth binding has no admission row. Invoke
rollback with the current revision, the original COMPLETE revision, and only
the fourth binding in `confirmRemove`. Do not use Compose rollback, restart,
`down`, or force-recreate.

```sh
pnpm -C apps/full-app d1:revision < "$D1_ROLLBACK_COMMAND" > "$D1_PROOF_DIR/rollback.json"
pnpm -C apps/full-app proof:d1-core capture > "$D1_PROOF_DIR/rollback-envelope.json"
jq -e '.ok == true and (.snapshot.bindings | length == 3)' "$D1_PROOF_DIR/rollback-envelope.json" >/dev/null
jq '.snapshot' "$D1_PROOF_DIR/rollback-envelope.json" > "$D1_PROOF_DIR/rollback-snapshot.json"
```

The verifier requires a revision newer than N+1, the initial desired digest,
the exact initial binding bytes, removal of only the unadmitted addition, and
unchanged core and ingress process identities/restart counts. Repeat the four
identity/count observations immediately before and after the rollback command.
Record the requested historical COMPLETE revision/digest separately from the
new monotonic publication revision/digest, plus the expected N+1 revision/digest;
the verifier binds all three identities and rejects an equivalent plan that is
not attributed to the original rollback target. Record the operation id only as
its domain-separated digest. The source/restored DR projection must contain the
matching prepared-then-committed destructive-publication operation with the
same expected/publication revisions and digests and only the fourth binding's
redacted identity in its removal set.

## Offline disaster-recovery rehearsal

Revision rollback is not disaster recovery. Rehearse this section using a real
backup and an isolated restore target.

1. Stop new ingress. Drain accepted effects and verify no turn is running.
2. Quiesce the core. Record the backup cutoff time.
3. Capture one encrypted backup set containing the external PostgreSQL database,
   D1 revision/sequence/audit state, workspace data, and Pi session data
   including every current JSONL session authority. Any additional current
   session-state files remain covered by the session-tree digest. Do not add
   host-artifact attestation data.
4. Generate a redacted manifest containing only logical component names,
   byte counts, and SHA-256 digests. Never include source/destination locations,
   database URLs, cookies, secret values, or file listings. With the source
   database and roots selected in the protected environment, independently
   capture its canonical fingerprint:

   ```sh
   pnpm -C apps/full-app proof:d1-core capture-dr > "$D1_PROOF_DIR/dr-source.json"
   jq -e '.ok == true and .dr.readableSessions > 0' "$D1_PROOF_DIR/dr-source.json" >/dev/null
   ```
5. Restore to a new PostgreSQL database and new physical storage reachable only
   from the isolated recovery network. Mount that storage at the same logical
   absolute D1/workspace/session roots used by the source; current Pi wrappers
   persist their native transcript location and the production loader does not
   rewrite it. Preserve the logical D1 host id. Do not create, start, or attach
   ingress.
6. With the restored state root selected only in the protected
   `BORING_D1_PROOF_STATE_ROOT` environment variable, the restored PostgreSQL
   URL selected as `BORING_D1_PROOF_DATABASE_URL`, and the restored workspace
   and session roots selected by their normal protected variables, run:

   ```sh
   pnpm -C apps/full-app proof:d1-core capture-dr > "$D1_PROOF_DIR/dr-restored.json"
   jq -e '.ok == true and .dr.readableSessions > 0' "$D1_PROOF_DIR/dr-restored.json" >/dev/null
   ```

   Do not start the core.
7. Compare deterministic, sorted SHA-256 projections for the admission rows,
   destructive-publication journal, workspace membership/ownership, complete
   revision history, active desired state, workspace data, and session history.
   Record equal, nonzero source/restored counts as `admissionRows`, `journalRows`,
   `membershipRows`, and `revisionRows`. Read at least one JSONL session and its
   messages. Bind the workspace projection as `workspaceDataDigest`. Record only
   digests and counts. Every revision directory must open successfully through
   the immutable COMPLETE-revision reader; include its sorted redacted
   revision/digest pair in `completeRevisions`. The initial, N+1, and monotonic
   rollback publications must all remain readable. The state, workspace, and
   session logical absolute roots are represented only by dedicated SHA-256
   digests and must match between source and restore. `admittedBindingDigests`
   must contain exactly the three
   initial binding digests and must exclude the rolled-back addition.
8. Record `ingressStarts: 0`, RPO as backup cutoff minus the last durable
   accepted record, and RTO as restore start through all offline checks passing.

`capture-dr` implements one canonical projection contract for both source and
restore: UTF-8 lexicographically sorted object keys, UTC timestamps, decimal
counts, sorted query results/tree entries, then SHA-256 over compact JSON. The
projector keeps row values internal and emits only aggregate digests/counts.
Admission rows contain sequence, binding id, execution-identity digest, first
revision/digest, and admitted time. Journal rows contain sequence, operation id,
state, expected/target revisions and digests, removal-binding ids, and recorded
time. Membership rows contain workspace/user ids, role, member creation time,
workspace creator/manager, and deletion time. The revision-state,
workspace-data, and session-history trees use sorted tuples of entry kind,
relative-path digest, mode, byte count, and content digest; never follow links or
include their raw targets. Reject special files. The source and restore commands
read their selected database and roots directly; never copy one side into the
other. Put `.dr.identity` from each envelope into `dr.source` and `dr.restored`,
and use the restored `readableSessions` count.

Session readability uses Pi's production loader for non-migrating transcripts.
Legacy Pi versions are migrated and validated in bounded memory only; capture
does not rewrite restored session files or start the core. A single transcript
over 16 MiB is fingerprinted but is not counted as the required readable
session; ensure the rehearsal includes at least one representative readable
session within that bound. Database projections use a repeatable-read,
server-sized cursor and fail closed above 200,000 rows per history or 64 MiB of
physical/canonical row data instead of exhausting memory.

This v1 record is operator-attested proof, not host-origin authentication.
Approved-release and other host-artifact authenticity remains the explicit
`wt-391-forward-tz4` gate.

Keep the restore isolated after the proof. Publication is a separate owner
decision and is not part of this rehearsal.

## Assemble and verify

Assemble `proof.json` with the exact `boring-d1-core-proof:v1` contract in
`d1CoreProof.ts`: the three captured snapshots, chained authorization counters,
continuity observations, timing, equal source/restored DR fingerprints, and the
two false redaction flags. Values must come from the commands above; do not copy
the test fixture.

The final command reruns the hostile docker-runsc suite live, checks all eleven
probes and the secret canary, and then validates the complete proof:

```sh
pnpm -C apps/full-app proof:d1-core verify-live < "$D1_PROOF_DIR/proof.json" > "$D1_PROOF_DIR/report.json"
jq -e '.ok == true and .report.status == "pass"' "$D1_PROOF_DIR/report.json" >/dev/null
jq '.report' "$D1_PROOF_DIR/report.json"
```

Attach the last redacted report plus pass/fail summaries for the acceptance
commands. If this live run was not performed on the EU host, state that plainly:
the harness, integration proof, and runbook are complete, while live EU/DR
evidence remains an owner/operator follow-up. Never substitute the committed
isolation evidence file or synthetic DR values.

## Recovery and abort boundaries

- Failure before active publication leaves the prior COMPLETE revision served;
  rerun the same command after correcting the stable error.
- A lost publication acknowledgement is recovered by the existing #777
  authority/journal path before another mutation. Do not edit pointers.
- `D1_BINDING_ADMITTED` forbids removal. Restore the additive revision or use a
  maintenance restart procedure; do not override the ledger.
- Any identity, restart-count, admission, journal, membership, session, or DR
  digest mismatch fails the proof. Keep ingress stopped and investigate.
- Retain the protected evidence/backup set under the operator's normal retention
  policy. Cleanup requires the same explicit operator authorization as other
  production data deletion.
