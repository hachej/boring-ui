# SBX1.3 proof ledger — 2026-07-22

This is non-admitting implementation evidence. It does not claim fleet
admission, an exact production cohort freeze, or escape resistance.

## Automated gates

| Exact command | Result |
| --- | --- |
| `rtk pnpm -C packages/boring-sandbox build` | PASS; ESM and declaration builds completed for all nine package entrypoints. |
| `rtk pnpm -C packages/boring-sandbox test` | PASS; 51 files, 475 tests. |
| `rtk pnpm -C packages/boring-sandbox lint` | PASS; TypeScript plus all Sandbox package invariants. |
| `rtk pnpm --filter @hachej/boring-agent exec vitest run src/shared/__tests__/error-codes.test.ts` | PASS; 1 file, 6 tests, no type errors. |
| `rtk go test ./... && rtk go vet ./...` from `packages/boring-sandbox/src/providers/runsc/runtime/workload` | PASS; 17 tests, no vet findings. |
| `rtk go test ./... && rtk go vet ./...` from `packages/boring-sandbox/src/providers/runsc/runtime/quota-helper` | PASS; 3 tests, no vet findings. |
| `rtk pnpm lint` | PASS; generated artifacts, Agent resources, and import audit. |
| `rtk pnpm lint:invariants` | PASS; Agent, boring-bash, Sandbox, and Workspace plugin invariants. |
| `rtk pnpm run typecheck` | PASS; full package build followed by all 31 workspace-project typechecks. |
| `rtk git diff --check` | PASS. The repository exposes no top-level format script. |

## Real Docker+runsc integration

Exact command:

```text
rtk env RUN_RUNSC_INTEGRATION=1 pnpm --filter @hachej/boring-sandbox run test:runsc:integration
```

Result: PASS as non-admitting evidence; 11 passed, 3 operator follow-ups,
0 failed. The raw machine-readable result is
[`runsc-runtime-integration-2026-07-22.json`](./runsc-runtime-integration-2026-07-22.json).

Passed probes:

- runsc guest sentinel (`4.19.0-gvisor`) and digest-pinned workload image;
- fail-closed session creation when the required path primitive is absent,
  including removal of the rejected container;
- exact `65532:65532`, `--runtime=runsc`, `--network none` workload creation
  on the explicitly non-admitting helper-bypass path;
- durable workspace write, background and double-fork reaping, non-model
  secret delivery and post-secret container replacement;
- planted secret absence from container env/argv, Docker inspect, labels, image
  inspect, and image history;
- model-provider-credential rejection before Docker exec;
- timeout process-group cleanup with a clean subsequent baseline;
- external IPv4/IPv6, metadata IPv4/IPv6, sibling, worker bridge, DNS, and
  Docker-socket denial, with loopback as a positive control;
- teardown of every session container.

Operator follow-ups:

1. `workspace-openat2-fs`: this runsc release returns `ENOSYS` for Linux
   `openat2` syscall 437. Product session creation correctly fails closed and
   removes the container; there is no realpath fallback.
2. `symlink-swap-race`: because the mandatory primitive is unavailable, the
   mutating helper and its race probe cannot be admitted or truthfully run on
   this profile.
3. `project-quota-fill`: the host ext4 mount lacks `prjquota`/project-quota
   mount support. Enabling it would mutate host filesystem policy, so the real
   fill/sibling/reserve probe was not run here.

After the fail-closed `openat2` result, the harness runs process, secret,
timeout, egress, and teardown probes through an explicit workload-only
`nonAdmittingPathHelperBypass`; this is proof of those mechanisms, not proof of
the rejected workspace helper or a production-ready session.

## Independent review

Claude Opus performed the required different-model read-only security and
thermonuclear maintainability review. The first pass reported no P0/P1 and
identified eight P2/P3 correctness/hardening/maintainability findings. All were
fixed: workspace envelope symmetry, Go module decomposition, heap-based nonce
expiry, locked quota collision probing, sanitized causes, extracted exec
failure recovery, retention of replay markers through terminal retirement, and
workspace-root/control-socket hardening. The post-fix pass returned PASS with
no P0/P1/P2; its remaining base64 boundary P3 was then fixed and covered by a
Go boundary test. A final executor contract audit additionally moved host
reserve enforcement into the root quota helper and made the Docker mount source
derivable only from a configured root plus validated workspace UUID.

## Documented deviation

Docker 28.2.2 rejects the plan's literal `--mount ... ,rw` token for the
key/value `--mount` grammar. The argv builder emits the equivalent explicit
`readonly=false`; every other V3 Docker control is emitted as specified. This
syntax was exercised by the real runsc harness.
