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

## Local proof refresh — 2026-08-10

The freshly landed slices 1–3 at `origin/main` `637999391` were exercised on
this OVH VM with Docker 28.2.2 and the real gVisor runtime
`runsc version release-20260706.0` (`4.19.0-gvisor` guest sentinel). The exact
integration command above reported **12 passed / 3 operator follow-ups / 0
failed**. The raw result is
[`runsc-runtime-integration-2026-08-10.json`](./runsc-runtime-integration-2026-08-10.json).
The accompanying local gates also passed the package build, 19 workload
supervisor Go tests plus `go vet`, and 8 quota-helper Go tests plus `go vet`.

The run proved the fd-3 credential canary was delivered without leaking: it
was absent from the container environment, argv, inspect data, labels, image
inspection/history, and the replacement container, while the workspace was
read-only during delivery. It also proved the complete default-deny egress
matrix: external IPv4 and IPv6, metadata IPv4 and IPv6 link-local, a sibling
container, the worker bridge (`172.17.0.1`), DNS, and Docker socket access were
all denied; loopback succeeded as the positive control.

The three environment follow-ups remain explicit and non-admitting:

1. `workspace-openat2-fs`: runsc release-20260706.0 returns `ENOSYS` for
   `openat2` syscall 437; product session creation fails closed and removes the
   rejected container, with no realpath fallback.
2. `project-quota-fill`: the host ext4 workspace volume is mounted without
   `prjquota`, so the harness does not mutate host filesystem policy to run the
   real fill/sibling/reserve probe.
3. `symlink-swap-race`: blocked by follow-up 1 because the mandatory `openat2`
   helper cannot be admitted, so the mutating race probe cannot be truthfully
   exercised on this profile.

Everything after the admission refusal ran through the labeled workload-only
`nonAdmittingPathHelperBypass`. This demonstrates those mechanisms and the
fail-closed gate; it does not claim a production-ready session or fleet
admission.

Production still requires:

1. a pinned, qualified runsc build whose profile implements `openat2` and
   admits the real workspace helper and symlink-race probe;
2. ext4/XFS worker data volumes provisioned with `prjquota`, followed by the
   real quota fill, sibling, and reserve probe;
3. the quota helper installed as a preconfigured root-owned binary rather than
   run from a source checkout;
4. fleet admission evidence for the actual worker cohort, including the
   qualification bundle (`fleetAdmissionClaimed` remains `false` here); and
5. production operational plumbing: a real registry and image pipeline,
   worker provisioning, and deployed V1 remote-worker credential-ref wiring.
