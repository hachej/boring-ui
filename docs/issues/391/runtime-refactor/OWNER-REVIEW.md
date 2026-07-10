# #391 owner review guide

Status: current-main/open-PR guide as of 2026-07-09. `INDEX.md` remains the
ordering authority.

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

## Active queue

| Order | PR | Decision before review | Primary owner check |
| --- | --- | --- | --- |
| 1 | #557 | rebase/amend, then merge independently | current release cohort and publish ordering only |
| 2 | #543 | rebase/amend | pure mode preserves landed event work; no core completion claim |
| 3 | #545 | restack/amend | Pi audit seals all cwd/workspace assumptions used by pure mode |
| 4 | #547 | restack/rename | remove `[closes P1]`; invariant actually closes only baseline P1 |
| 5 | #566 | restack/amend | compatibility facts are diagnostic, never authority |
| 6 | #568 | restack/amend | no `runtimeMode` feature gating; E1 sink resolution still remains |
| 7 | #575 | restack | `/core` transitive graph is server/Pi-default free |
| 8 | #576 | restack/amend | exact-once per-agent disposal; shared provider disposed only by host; caches bounded |
| 9 | P1 prE | new | admission, request idempotency, attribution, and duplicate-tool policy |
| 10 | #549 | rebase if R0 remains urgent | bearer auth/quota plus attributed/idempotent M1 delivery; temporary config names A1 owner |
| 11 | #556 | restack after #549 | authenticated stock client gets bounded self-contained output; no dangling path |
| 12 | #546 | rebase after P1 | post-relocation durable routes; trusted structured stream/session scope |
| 13 | #559 | split/amend | approval authority separate from ask-user migration; no delete-before-outcome window |
| 14 | T1 recovery | new | Pi JSONL committed but stream append failed is deterministic after restart |
| 15 | T1 request receipts | new | request idempotency survives restart and admission crash never duplicates a run |
| 16 | #548 | rebase after P1 | direct+bwrap move is atomic with consumers/origin removal |
| 17 | #558 | restack after #548 | Vercel move is atomic and preserves provider-only ownership |
| 18 | #564 | split/restack | remote-worker move separate from mode/composer cutover; no silent direct fallback |
| deferred | #581 | mark draft | no merge before E1/P5a, native-mount consumer, no-leak and credential proof |

## P1 acceptance card

- Public `start()` owns per-session admission; callers cannot bypass it.
- Same `requestId` + same payload returns the original receipt; a conflicting
  payload fails with a stable code.
- `actor` and `originSurface` survive into session/run metadata.
- Duplicate tool names follow one deterministic fail-closed policy in every
  composer.
- Core receives no host/provider-global lifecycle authority.
- Eviction, recreation, failure, and app close dispose each agent-local resource
  exactly once; early stores and worker runtimes are bounded.

## T1 acceptance card

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

- Each provider move migrates consumers and removes the origin in the same PR.
- `direct` is explicit trusted-local policy, never automatic deployed fallback.
- Provider facts are reported or unknown; unknown never silently grants.
- Remote-worker relocation and mode/composer rewiring are separately reviewable.

## Product review card

Do not approve v1 from component gates alone. Require the recorded golden path:

```txt
scaffold -> validate -> local turn -> dedicated EU apply -> exact HTTPS URL
-> landing -> member auth -> bound workspace -> deployed default agent
-> rerun -> rollback
```

Owner evidence: elapsed time <=15 minutes with infrastructure preconfigured,
zero platform-source edits, definition/deployment/resolved digests, remote
materialization without access to the authoring checkout, fenced crash-safe
reapply with no duplicate resources, exact-host/TLS proof, bounded public
landing content, membership-gated trusted workspace resolution, forged
workspace/agent selector rejection, complete-snapshot rollback, and no raw
secret in output/logs/manifests.

## Architecture review card

- P6-D bundle registry is keyed by `(definitionId, version)` and stores a
  verified immutable definition+assets+digest; P6-R resolved registry is
  separately keyed by deployment `agentId`.
- Host owns prepared environment operations/lifecycle; agent core receives
  flattened tools/prompt/readiness/input handling plus methodless facts.
- Prompt order is base -> immutable agent instructions -> resolved capability
  and plugin fragments -> active skill index -> static host append -> per-turn
  dynamic host context. Plugin prompt text is admitted and removed with its
  contribution, never merely because the package was discovered or installed.
- P6 retains and digests the source-labeled static prompt plan, including static
  host append. Only explicitly per-turn dynamic host context is outside static
  identity and it cannot grant authority.
- P3 emits one immutable activated-plugin snapshot tied to the host-app
  artifact and canonical redacted activation inputs. P6 resolution, D1 desired
  state, restart, and rollback retain that identity; mutable or non-
  reconstructible plugin sources are not D1 production inputs. Browser-front
  failure preserves previous-good UI and does not pretend to unregister boot-
  time routes.
- Maximum authority comes from provider+host+workspace+deployment policy;
  grants/session scope narrow it; requirements only validate.
- Filesystem UI remains workspace-owned in v1 but is absent, including API
  calls, when resolved filesystem capability is absent.
- D1 `DedicatedSiteSpec` is host-owned and binds one exact hostname to one
  membership-authorized workspace. That workspace selects the deployment as
  agent `default`; the definition, landing page, and browser cannot choose a
  different workspace or agent. Dedicated server scope covers every workspace-
  bearing API. P3's scoped route registrar supplies bound Workspace/scoped
  repositories; raw arbitrary plugin routes fail D1 readiness. List exposes only
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
