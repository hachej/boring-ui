# Stress test: the hub and its factory

Status: consumer requirement map, specification only; not independently executed or certified by the redaction audit. The portable first subset is now accepted in [HUB-M1.md](../compatibility/HUB-M1.md), with owners, gates and test obligations. Requirements outside that subset and particular provider choices remain proposals, not library defaults. This is an additional consumer after
[REDACTION.md](REDACTION.md). It is `hachej/boring-hub`'s SPEC.md revision 5
(PR #58, 2026-10-02): a hub where a domain expert works with agents over
projects stored in git, and a factory where builders and verifiers change
application code under gates. This file lists what the hub needs from v4,
maps each need onto [SPEC.md](../architecture/SPEC.md) and
[CONTRACTS.md](../contracts/CONTRACTS.md), and names the gaps. It adds no
law; where a need is already covered, it says which section covers it.

## The hub's workloads

| Workload | v4 profile | What runs |
| --- | --- | --- |
| Assistant and PM agent | Virtual workspace recipe: one VFS/overlay + just-bash + installed Git commands | Conversations scoped to a project or an artefact; writes to document paths only |
| Builder | Isolated coding | One claimed task on a task branch, in a microVM, agent loop outside the VM |
| Verifier | Isolated coding, without publication | One candidate commit, checks and a driven UI, a structured verdict |
| Triage and release agents | Application agent recipe | Event-driven structured tasks over hub records; no files |

The hub keeps its own records: projects, approvals, claims, candidates,
promotion authorisations, rooms and the inbox. v4 owns execution, decisions
pending inside an execution, and effect evidence.

## 1. A git resource provider

The hub's content lives in git repositories, mounted per project as
`{repository, ref, path}`. The provider is built on isomorphic-git over a
local object cache, with the host's adapter fetching and pushing.

| Need | v4 coverage | Gap |
| --- | --- | --- |
| Revision `<blob>.<commit>`; pinned reads return the version at a commit or refuse | Files and resources: pinned reads | None |
| A publication of several files is **one commit**: all or nothing | Operations: provider batch transactions | Declare the git provider strong for batch publication; a fast-forward push is the commit point |
| Duplicate lookup by operation ID after a lost push response | Operations: duplicate lookup | The provider finds the commit by an operation-ID trailer (`Boring-Execution`) on the target ref |
| Conditional commit | Operations: expected revisions | The expected revision of a multi-file publication is the base commit plus the blob of each target |
| Revocation fencing | Authority: providers unable to fence report the weaker guarantee | A remote git host cannot fence a push already sent; the provider declares this |
| History and diff of one path between revisions | Files: historical revisions | A history listing (commits touching a path) and a two-revision diff in the provider contract |
| Path classes: document paths may be published on the mounted ref; every other path is code and is refused there | Resources: confinement | Write classes per path, from the project's `project.md`, failing closed: an unknown or invalid policy makes every path code |

## 2. Snapshots, overlays and stale inputs

Several turns run in parallel on one project: the PM on a contract, the
assistant on a mockup, a person saving a document. The hub's review of its
own spec found that a shared working tree mixes their writes.

| Need | v4 coverage | Gap |
| --- | --- | --- |
| Each execution reads from a snapshot pinned at its start; a newer version is never returned silently | Submission: input snapshot | The mount snapshot (a commit per mount) is part of the submission's captured input |
| Dependencies include content reads, listings, searches and observed absence | Structured work: retain durable tool evidence | Provider declares invalidation granularity and captures these inputs; a matching added file cannot evade stale-input checks |
| Refreshing is deliberate and recorded | Hub M1 H02 | Input snapshot remains immutable. Preserve unfinished work as a proposal and create a new attempt; refresh cannot relabel old reads/derived writes |
| Each execution writes to a **private overlay**, invisible to other executions, durable across a crash | Virtual Bash: read-only/scratch staging first | A durable per-execution overlay over a mount snapshot, owned by the execution's Pi state; cancelling one execution discards only its overlay |
| Publication at the end of a turn: a short lock, then a conditional batch publication | Execution: publication carries original revisions | Publication checks **inputs as well as targets**: if a path the execution read changed since its snapshot, the outcome is `stale-input`, not a commit |
| A refused publication becomes a proposal, not a loss | Operations: conflict outcome | The overlay and its diff against the new head remain readable for the host to present |

Required tests: two concurrent executions never see or publish each other's
staged writes; cancelling one leaves the other intact; a changed input
blocks publication even when no written path conflicts; a crash between
commit and acknowledgement is reconciled by operation ID, never committed
twice.

## 3. Isolated coding for builders and verifiers

SPEC.md's isolated coding profile and ROADMAP phase 5 cover the principle.
The hub needs these specifics.

| Need | v4 coverage | Gap |
| --- | --- | --- |
| A workspace provider: create from an image and a snapshot, clone a repository at a commit, `exec`, file access, expose a port, stop, **reattach by id after a runner restart** | Execution: explicit provider, no host fallback | The provider contract, with Vercel Sandbox as the first adapter and a local container adapter for development |
| The agent loop runs **outside** the VM and acts on it through tools | Execution: isolated workspace | State that the Pi harness runs in the runner; the VM only executes commands |
| No credential enters the VM: model calls, GitHub and the hub are reached by the runner | Authority: credentials server-side | Egress policy per workspace (registries and declared test services only), with a test that an undeclared host is unreachable from the VM |
| A builder's result is published by the runner: commit and push of the task branch with the runner's token | Execution: execute and publish grants are distinct | A `publish-branch` operation whose target is a branch, never the mounted ref, with the original base commit as expected revision |
| A verifier **has no publication capability installed**, not merely denied | Execution: recipe cannot fall back to stronger capabilities | A verifier recipe defined by the absence of any publish operation |
| Candidate source and declared verification inputs stay integrity-protected throughout execution; outputs use separate writable paths | Accepted Hub M1 H04; hub SPEC §11.12 | Qualify provider enforcement across file RPC/native commands; edit→restore cannot pass the original candidate. Before/after hash alone is insufficient; scratch investigation is not verification |
| A verifier's verdict is a structured output bound to the commit it checked, with logs and screenshots retained as evidence | Structured work; tool evidence | An evidence artefact type (log, screenshot, trace) bound to the workspace's commit, retained under host policy |
| Runs of hours, with questions to a person in the middle | Decisions: persisted before presentation; Pi owns waits | Workspace lifetime across a wait: snapshot and stop the VM while waiting, resume on the answer |

## 4. The hub as a caller of remote tasks

The hub's `boring-sandbox` adapter starts builders and verifiers as tasks of
an attachment hosted by the runner.

| Need | v4 coverage | Gap |
| --- | --- | --- |
| Submit a named task (`build`, `verify`) with an input snapshot `{repository, commit, work packet, approved payload digest}` and a request key | Submission and task | None |
| Status, events, follow-up message, cancel | Wire and projections; cancellation requests | A follow-up into a running task (steer), not only into a conversation |
| The result reaches the hub durably, even after a restart | Structured work: durable delivery intent | The hub is a delivery target over HTTP with an idempotent operation ID |
| Questions from the builder reach the expert through the hub, and the answer returns to the same task | Optional native decision extension; accepted H05 | Hub projects the original runtime question; authenticated delegated resolution binds that runtime/task/question/scope/digest/expiry. No second resolvable question, and clarification cannot approve a changed product contract |

## 5. Models on a subscription

The hub's agents and the sandbox runner use models on a ChatGPT subscription
through an OAuth sign-in (the `openai-codex` provider), not API credits.

| Need | v4 coverage | Gap |
| --- | --- | --- |
| Credentials chosen per admitted request by the host; no process-global login | Authority; model admission | None |
| The host owns the token refresh; a refresh races two parallel executions safely | — | One refresh at a time per credential, shared by every attempt |
| Rate-limit and plan-quota errors are typed and retried under the admission path, not shown as model failures | Model admission: retries through the adapter | Typed `rate-limited` and `quota-exhausted` outcomes |
| Usage recorded in tokens with **no invented price**: a subscription has no per-token cost | Usage: unknown usage stays unknown | A `pricing: plan` marker so that reporting shows tokens without a cost |

## 6. Viewers, mockups and annotations

| Need | v4 coverage | Gap |
| --- | --- | --- |
| HTML mockups are interactive model-written pages | HTML viewer: passive by default, interactive is a separate opt-in | The interactive mode's bridge, below |
| The frame is `sandbox="allow-scripts"` without `allow-same-origin`, so it has an **opaque origin**; origin-checked `postMessage` cannot be used | — | A bridge per frame instance: on each load the host creates a `MessageChannel` and a nonce and transfers one port to that frame; it listens only on its port; navigation or reload closes it; messages are an allowlist (`ready`, `focus`, `anchor`, `snapshot`), schema-validated, at most 64 KiB, rate-limited; nothing on the channel carries authority |
| Annotations anchored in an artefact at a revision | Page commands: bound targets | An anchor contract per viewer: Markdown (quote with prefix and suffix, heading path), HTML (selector, text, bounding box), canvas (element ids or region), image and PDF (page and rectangle) |
| Re-anchoring on a newer revision, with an explicit **outdated** outcome | — | A pure function from `(anchor, old revision, new revision)` to `placed | outdated`, shared by browser and server |
| Canvases are **tldraw** (`.tldr`): decided by the hub on 2026-10-02 | Canvas: tldraw is now the v4 default, explicitly selected by Julien | Use the document/session and asset/license boundaries in CANVAS.md. Persist the document, not viewport or selection; validation, migrations and conditional writes for agent and human edits; no executable scene code. Additional formats can use host viewer registration; no Excalidraw default is planned |

Superseded on 2026-10-05: feedback (anchors, notes, recordings) is a framework
feature stored as resources in each application's workspace, usable without an
agent and by agents through an opt-in capability; it is not a hub comment store.
See [FEEDBACK.md](../architecture/FEEDBACK.md).

## 7. Approvals bound to a digest

The hub binds an expert's approval to the **digest of a canonical payload**
(the behaviour-bearing fields of a feature contract and its body), and
revalidates it at dispatch, verification, merge and promotion. Those are hub
records. Inside an execution, v4's decision contract already binds an exact
operation digest; the hub needs one more thing: an execution started under
an approval carries the approved digest in its input snapshot, so that the
hub can stop it when the approval is invalidated.

## 9. Running an app's declarative capabilities

The hub runs an app's **declarative agents** (agent.md, rules.md, tool.json,
no code) and its **sandbox tools** (`tools/<name>/index.js`, plain JS with no
imports) straight from the app's repository files. It needs from v4:

- loading agent definitions from files read at a commit, without importing
  any code from them;
- code mode (QuickJS/WASM) running a sandbox tool with only the operations
  the hub injects (read and write the project's artefacts, call another
  app's exposed tools), with limits on time, memory and output, each nested
  call admitted and receipted;
- the same runner usable in an app's server, so a sandbox tool behaves the
  same in both places.

## 10. Agents on Cloudflare Workers

Apps may run on Cloudflare (Hono + D1). Tested on 2026-10-02 with
`wrangler dev`: `@hachej/boring-agent` (v3, Flue) builds for a Worker but fails at
`new DatabaseSync` (node:sqlite, "Illegal constructor"); it also reads its
definitions and model login from files and runs agents beyond the request
that started them. v4 should state whether Pi Durable can run in a Worker
(Durable Objects for state, a storage provider other than node:sqlite,
definitions and credentials supplied by the host). Until then a Cloudflare
app's agents are declarative and run by the hub.

## Acceptance for this consumer

v4 passes the hub stress test when, on a fake model and then on the
subscription model:

1. Two parallel executions on one git mount publish two separate commits,
   each containing only its own writes; a changed input makes one of them a
   proposal.
2. A builder in a Vercel Sandbox microVM builds and tests a real repository,
   and the runner pushes its branch; the VM never held a token, and an
   undeclared host is unreachable from it.
3. A verifier produces a verdict/evidence bound to actual protected candidate
   and verification inputs, with separate writable outputs and no publish
   operation. Attempts to edit a tracked source/test, even edit then restore,
   cannot count as a pass for the original candidate. Scratch repairs are findings.
4. A runner restart during a builder's run reattaches to the VM or ends it
   explicitly, and the hub receives exactly one result.
5. Two HTML mockups open side by side cannot send on each other's channel; a
   reloaded mockup's old channel is dead.
6. A subscription rate limit during two parallel executions is retried
   without being reported as a model failure, and usage shows tokens with no
   cost.
