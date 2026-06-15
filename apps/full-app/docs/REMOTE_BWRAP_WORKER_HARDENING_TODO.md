# Remote bwrap worker hardening TODO

Scope: `boring-sandbox-worker` only. Public `boring-full-app` remains uncut until `BORING_WORKER_BASE_URL` is deliberately set on the public app.

## Applied now

- [x] Worker image excludes `/app/apps/full-app` and runs only the internal worker entrypoint.
- [x] Worker workspace paths require UUID workspace ids.
- [x] Worker has no public `http_service`.
- [x] Worker token is required for every non-`/health` route.
- [x] bwrap receives an allowlisted env only; worker process secrets are not passed through.
- [x] Run worker app process as non-root after preparing `/data/workspaces`, with `no_new_privs` set.
- [x] Add `--new-session` to bwrap invocations.
- [x] Add `--cap-drop ALL` for hardened bwrap invocations.
- [x] Disable bwrap network namespace sharing for worker exec by default.
- [x] Keep an explicit emergency opt-in for worker bwrap networking via `BORING_WORKER_BWRAP_NETWORK=shared`.
- [x] Apply per-exec shell limits before user commands: CPU seconds, max file size, process count, open files, and virtual memory.
- [x] Install `ripgrep` in the worker image so remote search/grep tools work in production.
- [x] Add Fly volume backup automation for `worker_workspace_data` with scheduled snapshots and 14-day retention.

## Next hardening pass

- [ ] Add a seccomp profile and wire it through `bwrap --seccomp FD`.
- [ ] Deny/limit dangerous syscalls: `clone`, `unshare`, `setns`, `mount`, `umount2`, `pivot_root`, `ptrace`, `bpf`, `perf_event_open`, `keyctl`, module/kexec/reboot/swap/syslog syscalls.
- [ ] Add cgroup/pid/memory/file-size limits at the Fly Machine or worker supervisor layer; current limits are per-process shell `ulimit` caps.
- [ ] Add egress policy if networked exec is re-enabled for package install flows.
- [ ] Add scheduled image rebuilds for Debian/bubblewrap/ripgrep security updates.
- [ ] Add a post-deploy smoke that proves the running Fly worker process uid is non-root.

## Operational notes

- Do not set model/provider keys, DB URLs, auth secrets, mail secrets, or app session secrets on `boring-sandbox-worker`.
- The public app should only be cut over after setting a matching `BORING_WORKER_INTERNAL_TOKEN` secret on `boring-full-app` and deliberately setting `BORING_WORKER_BASE_URL` there.
