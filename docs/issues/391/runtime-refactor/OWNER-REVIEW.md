# #391 owner review guide

Status: **proposed** workspace-first v1 review guide as of 2026-07-10. It
becomes main authority only when the amendment PR merges. `INDEX.md` remains
the ordering authority inside this proposal.

## Review rule

Review one semantic risk at a time. Do not review a stacked PR as though its
base were already accepted. For every PR:

1. Confirm the base is the immediately preceding accepted branch or current
   `main` for an independent PR.
2. Read only the PR's own commits/diff against that base.
3. Reject stale proof labels such as "all pass" after any rebase.
4. Check the named acceptance and ownership boundary before code style.
5. Record one decision: merge, amend, split, or defer. Do not leave an implicit
   partial approval.

## Stopped-stack disposition

| PR | Decision | Primary owner check |
| --- | --- | --- |
| #543 | **merged baseline; new corrective leaf from current main** | v1 adapters always bind an authorized workspace/runtime; preserve accepted boundary/event work |
| #545 | **do not merge; close/defer** | no-environment Pi seals are post-v1 research |
| #547 | **superseded/stopped** | do not dispatch; replaced by #616 |
| #616 (boundary-only recut of #547) | **parallel current-main boundary leaf** | package/Fastify/import invariant only; no pure-product acceptance; does not wait for the #543 correction |
| #566 | **defer into P6-R** | capability truth is resolved from workspace/deployment composition |
| #568 | **defer** | wait for a real workspace/runtime input-asset consumer |
| #575 | **recut after both current-main leaves** | move the real injected core boundary; no default/pure host fork |
| #576 | **rework after #575** | lifecycle/disposal first, readiness second; bounded caches; workspace-owned providers remain host-owned |
| #564 | **drop pure-only-bin cutover** | reconsider independent runsc/provider work only under narrow P2 |
| frozen | #546/#559 and all T1/T2/P3/E1 descendants | **post-v1** | do not restack until a named consumer reopens the lane |
| deferred | #581 | **keep deferred** | native-mount consumer, no-leak, credential, and performance proof required |

## P1 acceptance card

- Published `/core` is a real Fastify/runtime-package-independent boundary and
  receives harness, tools, sessions, and host composition explicitly.
- Every v1 adapter resolves an authorized workspace and approved runtime before
  constructing the agent; no definition/bundle executes directly.
- `actor` and `originSurface` survive where a current v1 surface requires them.
- Duplicate tool names follow one deterministic fail-closed policy in every
  composer.
- Core receives no host/provider-global lifecycle authority.
- Eviction, recreation, failure, and app close dispose each agent-local resource
  exactly once; early stores and worker runtimes are bounded.
- Durable admission and caller request idempotency remain T1-owned unless a
  current v1 consumer supplies a narrower accepted requirement.

## T1 acceptance card

Post-v1 under decision 21. Retain this card for its future reintroduction; it
does not block the dedicated v1 path.

- Events, pending approvals, waiting state, Pi re-tap keys, and caller request receipts share
  `agent.db` where atomicity crosses tables.
- Caller receipts key on trusted admission scope plus `requestId`; an exact
  retry after restart returns the original receipt and a payload mismatch
  conflicts.
- A request event cannot exist without an answerable/expired pending record.
- Restart behavior says `recovery`, `expiry`, or durable continuation; never
  calls a seeded new turn `resume`.
- Fault injection covers JSONL committed before stream append.
- Event/session access uses trusted structured scope; UUID uniqueness is not an
  authorization rule.

## P2 acceptance card

- V1 accepts only the package boundary and hardened runsc/systrap path consumed
  by D1; broad provider/mode relocation is post-v1.
- `direct` is explicit trusted-local policy, never automatic deployed fallback.
- Provider facts are reported or unknown; unknown never silently grants.
- Remote-worker relocation and mode/composer rewiring are separately reviewable.

## Product review card

Do not approve v1 from component gates alone. Require the recorded golden path:

```txt
scaffold -> validate -> authorized local workspace + approved runtime -> local turn
-> dedicated EU apply -> exact HTTPS URL
-> landing -> member auth -> bound workspace -> deployed default agent
-> rerun -> rollback
```

Owner evidence: elapsed time <=15 minutes with infrastructure preconfigured,
zero platform-source edits, local workspace/runtime identity,
definition/deployment/resolved digests, remote
materialization without access to the authoring checkout, fenced crash-safe
reapply with no duplicate resources, exact-host/TLS proof, bounded public
landing content, membership-gated trusted workspace resolution, forged
workspace/agent selector rejection, and complete-snapshot rollback that
rematerializes the pinned immutable host artifact plus workspace-composition
manifest/digest and reproduces stateless P6-R output, with no raw secret in
output/logs/manifests.

## Architecture review card

- No v1 CLI, API, MCP, or channel adapter executes a bundle directly through a
  workspace-less `createAgent()` path. `headless` means no presentation UI,
  never no workspace/runtime authority.

- P6-D bundle lookup is keyed by `(definitionId, version)` and stores a verified
  immutable definition+assets+digest. P6-R is a stateless resolver over that
  bundle, a host-owned deployment, the existing authorized workspace
  composition manifest/digest, and narrow runtime facts; v1 adds no resolved
  registry or generation store. D1 alone pins host/composition inputs for
  rollback.
- Host owns prepared environment operations/lifecycle; agent core receives
  flattened tools/prompt/readiness/input handling plus methodless facts.
- Prompt order is base -> immutable agent instructions -> resolved capability
  and plugin fragments -> active skill index -> static host append -> per-turn
  dynamic host context. Plugin prompt text is admitted and removed with its
  contribution, never merely because the package was discovered or installed.
- The existing authorized workspace composer remains the v1 authority for
  plugins, prompts, skills, tools, routes, UI, readiness, and runtime. P6-R does
  not select those contributions, and full P3 snapshot/scoped-registrar work is
  post-v1.
- D1 consumes that authorized workspace composition and binds its deployed
  agent as the workspace `default`; it does not require a new P3 activation
  snapshot or P6 generation registry.
- Maximum authority comes from provider+host+workspace+deployment policy;
  grants/session scope narrow it; requirements only validate.
- Filesystem UI remains workspace-owned in v1 but is absent, including API
  calls, when resolved filesystem capability is absent.
- D1 `DedicatedSiteSpec` is host-owned and binds one exact hostname to one
  membership-authorized workspace. That workspace selects the deployment as
  agent `default`; the definition, landing page, and browser cannot choose a
  different workspace or agent. Dedicated server scope covers every workspace-
  bearing API through the existing host/bridge composition before lookup; this
  is not a P3 extraction dependency. Any plugin route that cannot consume the
  trusted bound scope fails D1 readiness. List exposes only
  the bound workspace and create/switch/delete are disabled. It also suppresses personal default-workspace creation for a
  non-invite dedicated signup without changing invite acceptance or generic
  signup. Generic behavior remains only on its configured listener; a dedicated
  process rejects every non-bound host and reserved/no-pointer hosts fail
  inactive before routing.
- Account deletion and member-role mutation cannot delete, transfer, or orphan
  the managed workspace outside the fenced D1 lifecycle.
- DNS/TLS publication and the active pointer stay blocked until host-produced
  readiness proves both fixed-workspace scope and the landing/sign-in/default-
  agent surface are installed for the current target/fence/staged desired state
  and exact site/host-app/plugin identity; replayed readiness rejects and an
  intermediate D1 stack is unreachable.
- The readiness value is not caller data: use an unexported opaque mint in-
  process or a fresh nonce-bound response over P5a's pinned-TLS worker channel.
  First external hostname activation follows complete-pointer CAS; a reserved
  host without a matching pointer fails inactive before generic routing.
- MCP exposure and shared-tenant routing are deployment/host authority, never
  fields that reusable agent behavior can grant itself.
