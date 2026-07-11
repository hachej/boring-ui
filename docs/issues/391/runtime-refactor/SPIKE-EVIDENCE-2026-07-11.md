# Spike Evidence — 2026-07-11

Three behavior spikes run on the production-candidate EU VM (Ubuntu, kernel
6.14, cgroup v2) to de-risk D1 and ID1 before dispatch. Raw agent reports
summarized; no repo or system-level changes were made (user-scope runsc
binary left at ~/bin/runsc).

## 1. runsc/gVisor structural validation (D1 provider lock input)

Facts on a real EU host: kernel 6.14 + unified cgroup v2 with full
controller delegation; `unprivileged_userns_clone=1`; netns and nftables
operations work (root); `runsc` release-20260706.0 installs user-scope and
**runs sandboxes successfully with sudo** (`runsc do echo ok`); rootless
fails on veth creation (CAP_NET_ADMIN); /dev/kvm present. Repo preflight
tests (28) pass but are 100% mocked. **Verdict: MORE NEEDED before lock —**
(a) one real, non-mocked `preflightRunsc` run against this host,
(b) an explicit privileged-execution-model decision (rootless is not
currently viable), (c) Docker daemon runtime registration untested by
design. Structural risk: LOW; the contract's assumptions hold on real EU
hardware.

## 2. Compose apply granularity (D1 runbook input)

Proven: adding a service does NOT restart existing ones; per-service env
changes recreate only that service. Rules required to keep it true:
one env file per agent (never shared), idempotent `up -d` only, never
`--force-recreate`, rollback per-service with `--no-deps` (a blanket
old-file `up -d` after recent modifications triggers state-correction
restarts). **Caveat:** whether agents are per-container at all is D1-R0's
decision (the binding model is a shared host process with atomic revision
applies) — these rules bind whatever container granularity D1-R0 picks.

## 3. Ory Hydra OAuth 2.1/PKCE (ID1 selection input)

Hydra v2.2.0: full auth-code + PKCE flow completed via curl (admin-API
login/consent accept); introspection works; wrong verifier → invalid_grant;
codes single-use even on failed exchange. Footprint: 41.8 MB image,
~21 MiB idle RSS — trivially hostable in the D1 compose. Gotchas: one-shot
`migrate sql` init step; token_endpoint_auth_method must match call style;
prod needs a real login/consent UI + Postgres. RFC status: PKCE yes; DCR
(7591) present but disabled by default; RFC 8707 exposed as `audience`, not
`resource=` (spec conformance unconfirmed); RFC 9728 absent — **which is
expected**: protected-resource metadata is served by the RESOURCE server
(boring's MCP endpoint), not the auth server. **Verdict: VIABLE for ID1;**
selection bead must still compare Keycloak on 8707 semantics + DCR, and
boring owns the 9728 endpoint either way.
