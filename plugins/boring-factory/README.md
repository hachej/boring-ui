# @hachej/boring-factory

Trusted, portable Factory identity and procedure resources for Boring applications.
This package is intentionally inert: installing it creates no Agent seat and grants no
Pi extension, skill, tool, provider, credential, or dispatch authority.

## Canonical sources

- Profiles: `agents/boring-orchestrator`, `agents/boring-worker`, and `agents/boring-reviewer` in this package.
- Worker procedures: repository-canonical `.agents/skills/plan` and
  `.agents/skills/exec`.
- Procedure companions: `.agents/skill-references/plan` and
  `.agents/skill-references/exec`.

`pnpm build` copies those procedures, their direct read-only procedure/reference
closure, and all three profiles byte-for-byte into `dist/resources`. The manifest maps
every packaged path to its canonical repository source and SHA-256. Generated
resources are package output and must not be edited directly. Only the top-level
`skills/plan` and `skills/exec` directories are projected as discoverable Worker
skills; bundled support skills and documents remain references, not extra grants.

## Trusted host composition

```ts
import { resolveBoringFactoryResources } from '@hachej/boring-factory/server'

const resources = resolveBoringFactoryResources()
```

The embedding app may compile `resources.agentSources` into an allowlisted internal
fleet and project `resources.skillRoot` only to the addressed Worker runtime. The app
continues to own seats, `/loop`, provider credentials/settings, quotas, and activation policy.

## Server host entry

```ts
import { createFactoryHost } from '@hachej/boring-factory/server'
```

`createFactoryHost({ repositoryRoot, workspaceRoot, stateRoot, env, provider })` returns
`{ agents, plugins, registry, sessionBindings, bind(app), rearm(), close() }` for trusted app
composition. `workspaceRoot` is the canonical, read-mostly repository checkout. The host owns
the persisted multi-epic registry (`<stateRoot>/epics.json`), session-to-epic bindings
(`<stateRoot>/session-bindings.json`), dispatch/review history
(`<stateRoot>/dispatches.json`), seat specs and appendices, `dispatch_worker`, `fresh_review`,
`factory_status`, `recover_stale_claims`, durable supervision, `demo_sandbox`, and the Factory
intake routes. The embedding app still owns the outer server and provider credentials/settings.

Every host uses the stable workspace scope `factory-hub`, giving all registered epics one
sessions surface and one Inbox. Each tool resolves its epic from the calling session binding,
or from its optional explicit `epicKey`, and then operates on that registry entry's worktree.
An unbound call fails with an error that names the `epicKey` override. Child sessions inherit
the parent's binding before their first prompt; if that prompt is rejected, the host removes
the new child binding again.

Factory intake is `POST /api/v1/factory/epics`; listing is `GET /api/v1/factory/epics`, and
`POST /api/v1/factory/epics/:key/adopt` attaches an existing Orchestrator session. Legacy
per-epic transcripts are copied into the hub session namespace during adoption while their
source files remain intact. Adoption is idempotent and transfers any persisted supervision
cadence to the adopted session. Intake request files must be relative regular files of at most
1 MiB whose canonical path remains beneath the validated epic worktree. Registry paths are
persisted canonically; the repository root and active worktree/branch reuse are rejected.
The registry is the source of truth: coupled writes persist it before bindings, and boot
reconciliation restores its Orchestrator bindings while dropping bindings for missing or
closed epics. Intake reports whether the optional kickoff was accepted; a
failed kickoff leaves the registered, bound Orchestrator available for an explicit retry.
`BORING_FACTORY_EPIC_KEY`/`BORING_FACTORY_FEATURE_NAME` values are accepted only as one-shot
intake on boot and are logged as such; they are no longer host identity.

### Gate 2 demos

`demo_sandbox start` uses the configured Factory sandbox provider. With
`BORING_FACTORY_SANDBOX_PROVIDER=local-simulation`, it clones the epic worktree at the
requested commit into a disposable local lease, links the checkout's existing dependencies
and build output, launches a single-command-line command with a scrubbed allowlisted
environment on `127.0.0.1`, and waits for `readyPath` to return an authenticated HTTP 200.
If the requested port is occupied or the child loses its bind, it selects a free port in
`4300-4399` and retries.
Set `BORING_FACTORY_DEMO_HOST` to the owner-reachable host or Tailscale IP advertised in the
returned URL; a host-owned proxy on that validated address reaches the process's enforced
loopback listener. Local demos remain trusted-code-only host processes, not containers; see
`docs/factory/RELIABILITY.md` for the exact boundary.

When Vercel cannot create the demo lease (including quota failures), the tool automatically
tries the local provider and returns `fallbackFrom: "vercel"` plus the original `reason`.
Local process-group start identity and lease details are persisted in `<stateRoot>/demos.json`;
stop, TTL expiry, and boot reconciliation terminate complete groups (including surviving
children) or discard stale entries without signaling reused PIDs. Only one demo may run per
epic. Both `/api/v1/workspace/meta` and `/api/v1/factory/epics` expose its
`activeDemoUrl`.

Do not add the skill root as a global package default and do not infer authority from
these authored files.

## Host-enforced Factory limits

The trusted host, rather than persona prose, enforces the Factory's recovery and retry
limits:

| Environment variable | Default | Host behavior |
| --- | ---: | --- |
| `BORING_FACTORY_STALE_IDLE_MS` | `600000` (10 min) | An in-progress claim whose assignee session is missing is stale immediately. An idle assignee with no canonical, Bead-specific handoff comment becomes stale after this duration, measured from the session's last activity. Busy claims are never stale. |
| `BORING_FACTORY_MAX_CONCURRENT_WORKERS` | `2` | `dispatch_worker` refuses before session creation when this epic already has that many busy Workers. |
| `BORING_FACTORY_MAX_DISPATCHES_PER_BEAD` | `2` | `dispatch_worker` refuses before session creation when the target Bead already has this many recorded dispatches. |
| `BORING_FACTORY_MAX_REVIEW_ROUNDS` | `4` | `fresh_review` still runs at the cap, but returns `capReached: true` and directs the Worker to hand off at the current SHA and file remaining findings as follow-up Beads. |
| `BORING_FACTORY_PLAN_BUDGET_MS` | `1200000` (20 min) | Intake persists a Gate 1 deadline and includes it in the kickoff. If supervision is armed and Gate 1 has not been raised by then, the next idle tick says `raise Gate 1 now with what you have`. It does not stop or kill the session. |

`factory_status` reports each in-progress claim's session classification and `stale`
flag, names `recover_stale_claims` as the recovery command, and returns the epic's
busy-Worker, per-open-Bead dispatch, and review-round counters. Recovery re-reads live
facts and releases only stale claims with `br update <id> --assignee "" --status open`,
then adds a Bead comment naming the dead session and reason.

Every admitted Worker dispatch and review round is written atomically to
`dispatches.json` with its epic, target, child session, timestamp, and latest outcome.
The file is read on every admission/status decision, so caps survive host restarts. At
either dispatch cap the target Bead is marked `blocked`, a blocker comment is added,
and the refusal tells the Orchestrator to raise an Inbox question with `ask_user`
instead of retrying.

## Private vendoring

No npm publication is required. From an exact reviewed Boring UI commit:

```bash
pnpm --filter @hachej/boring-factory build
pnpm --filter @hachej/boring-factory pack --pack-destination <trusted-output-dir>
```

The consuming private app commits the tarball, its source commit, and its SHA-256,
then installs it through a frozen `file:` dependency.
