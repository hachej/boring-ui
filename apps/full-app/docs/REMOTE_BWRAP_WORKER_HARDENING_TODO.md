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
- [x] Keep bwrap networking controlled by `BORING_WORKER_BWRAP_NETWORK`; launch-demo worker uses `shared` so agents can install user-requested deps.
- [x] Keep model/provider keys, DB URLs, and app secrets off the worker so networked exec cannot exfiltrate host-side credentials.
- [x] Apply per-exec shell limits before user commands: CPU seconds, max file size, process count, open files, and virtual memory.
- [x] Install `ripgrep`, Python 3, `pip`/`venv`, `uv`, `curl`, and `git` in the worker image so remote search and dependency-install demos work in production.
- [x] Add Fly volume backup automation for `worker_workspace_data` with scheduled snapshots and 14-day retention.

## Next hardening pass

- [ ] Add a seccomp profile and wire it through `bwrap --seccomp FD`.
- [ ] Deny/limit dangerous syscalls: `clone`, `unshare`, `setns`, `mount`, `umount2`, `pivot_root`, `ptrace`, `bpf`, `perf_event_open`, `keyctl`, module/kexec/reboot/swap/syslog syscalls.
- [ ] Add cgroup/pid/memory/file-size limits at the Fly Machine or worker supervisor layer; current limits are per-process shell `ulimit` caps.
- [ ] Add egress policy/registry allowlist for package install flows; current launch-demo worker allows sandbox egress for `uv`/`pip`/`npm` usability.
- [ ] Add scheduled image rebuilds for Debian/bubblewrap/ripgrep/Python/uv security updates.
- [ ] Add a post-deploy smoke that proves the running Fly worker process uid is non-root.

## Operational notes

- Worker sandbox network is enabled for the launch demo so agents can install dependencies. Do not set model/provider keys, DB URLs, auth secrets, mail secrets, or app session secrets on `boring-sandbox-worker`.
- The public app should only be cut over after setting a matching `BORING_WORKER_INTERNAL_TOKEN` secret on `boring-full-app` and deliberately setting `BORING_WORKER_BASE_URL` there.
