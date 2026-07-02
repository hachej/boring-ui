# Issue #416 — governed company filesystem binding plan

## Goal

Ship the Constellation-enabling feature as seven stacked PRs: a governed shared company filesystem that can be mounted/projected into agent runtimes with different policy-granted bindings.

V0 supports:

```txt
user
  private workspace filesystem
  readwrite
  default target for existing file tools/routes
  mounted in the app's normal workspace runtime

company_context
  shared company filesystem
  mounted/projected according to policy
  readonly filtered binding for normal users/agents
  readwrite management binding for privileged curator agents
  persistence/snapshots/backups hidden behind provider/sandbox implementation
```

## Final architecture decision

Do **not** create a new sandbox type. Add a generic filesystem binding model on top of regular runtime providers.

The app/provider still chooses the sandbox/runtime implementation. V0 proves the binding model with the fixture/local provider path first; direct/vercel/other providers are follow-up conformance work.

```txt
V0 proven path: fixture/local provider
future conformance: direct | local/bwrap | vercel | future providers
```

A filesystem binding says how a logical filesystem is projected into that runtime:

```ts
interface FilesystemBinding {
  filesystem: 'user' | 'company_context' | string
  access: 'readonly' | 'readwrite'
  mountPath: string
  projection: 'policy-filtered' | 'management'
}
```

Policy resolves bindings. Roles are not hardcoded:

```ts
resolveFilesystemBindings(ctx) -> FilesystemBinding[]
```

Production policy source is the host app DB (owned by core/full-app/Constellation), not files in the workspace. File-backed policy is allowed only for CLI/dev/test fixtures.

Example normal user/agent:

```txt
user              readwrite   /workspace         management/user workspace
company_context   readonly    /company_context   policy-filtered
```

Example privileged curator agent:

```txt
company_context   readwrite   /company_context   management
```

A normal user's company binding is safe only if the mounted/projected tree contains **only files that policy allows them to read**. Readonly alone is not enough if denied files are present.

## #391 / boring-bash alignment

This plan intentionally adapts #391's original “one public `/workspace` namespace” assumption. The #391 boring-bash plan must explicitly allow named filesystem bindings with `(filesystem, path)` identity inside one active runtime.

Ownership target:

```txt
@hachej/boring-bash/shared
  FilesystemId, FilesystemBinding, capability, prepared-binding contracts

@hachej/boring-bash/server
  binding resolver/provider lifecycle, routes, filesystem operations

@hachej/boring-bash/agent
  injected file/bash tool feature using existing Pi factory + Operations path

@hachej/boring-bash/plugin
  file tree roots, file viewers, workspace.open.path resolver

@hachej/boring-workspace
  hosts plugins and owns UiBridge dispatch/surface registry

@hachej/boring-agent
  receives injected tools/features only; no company fs ownership
```

PR 1 should initialize a tiny `@hachej/boring-bash` package skeleton if it does not exist yet. This is not the full #391 extraction: existing file/bash tools/routes/providers keep their current code paths until later migration. The new package initially owns only #416 contracts and minimal no-op boundaries needed by this stack.

PR 1 must also patch the #391 plan docs that currently assume one public namespace, at minimum `docs/issues/391/runtime-refactor/02-boring-bash-environment.md` and `docs/issues/391/runtime-refactor/07-tests-review-acceptance.md`, to mention named filesystem bindings and `(filesystem, path)` identity.

## Non-negotiables

- `company_context` is a separate filesystem identity, not a fake subfolder of `user`.
- Existing tools may omit `filesystem`; omission means `user`.
- Company access is explicit in tools/UI: `filesystem: 'company_context'` or equivalent bound root.
- Normal-user company binding is readonly and policy-filtered before mount/projection.
- Privileged readwrite company binding is policy-granted, generic, and not role-name hardcoded.
- Storage persistence details are provider-owned and out of this plan.
- Denied files are physically absent from readonly projections.
- No denied names/snippets/counts leak through list/search/grep/find or UI.
- Path prefix does not decide filesystem identity.
- `user:/x` and `company_context:/x` are distinct resources and tabs.
- UI shows Company as a separate root/tab/section, not as a user workspace subfolder.
- Readonly company viewers disable mutation affordances.
- MCP connections are out of scope.
- Transcript behavior stays like today's tool/command output; special redaction/retention is follow-up.

## PR stack

| PR | Plan | Scope | Done when |
| --- | --- | --- | --- |
| 1 | [`01-foundation-binding-model.md`](./01-foundation-binding-model.md) | Tiny `@hachej/boring-bash` package skeleton, binding contracts, provider lifecycle seam, policy shape, tool/schema feasibility, no behavior change | Package builds; contracts compile; existing agents remain unchanged |
| 2 | [`02-readonly-company-binding.md`](./02-readonly-company-binding.md) | Policy-filtered readonly company projection, fixture/local provider, leakage tests | Backend operations can read/search only allowed company files |
| 3 | [`03-agent-tool-wiring.md`](./03-agent-tool-wiring.md) | Existing Pi-style tools get `filesystem?` and route to company binding | Normal agent can use existing tools against `company_context` |
| 4 | [`04-readwrite-management-binding.md`](./04-readwrite-management-binding.md) | Policy-granted readwrite management binding through regular runtime providers | Curator agents can manage company fs through a readwrite binding without exposing it to normal users |
| 5 | [`05-ui-bridge-filesystem-identity.md`](./05-ui-bridge-filesystem-identity.md) | UI bridge/surface file identity plumbing | UI opens distinguish `user:/x` and `company_context:/x` |
| 6 | [`06-company-filetree-root.md`](./06-company-filetree-root.md) | Company root/tree beside Workspace | Users can browse policy-filtered Company root |
| 7 | [`07-readonly-company-viewers.md`](./07-readonly-company-viewers.md) | Readonly viewer/editor behavior for readonly bindings | Company files open readonly with no mutation paths |

Older drafts live under [`archive/`](./archive/) for context only.

## Full-feature acceptance

A host can configure policy like:

```txt
Julien default agent:
  company_context:/company/hr/**       readonly
  company_context:/company/finance/**  denied

Curator agent:
  company_context:/company/**          readwrite management
```

Then:

- Julien sees/browses only allowed company files.
- Julien's tools can use `filesystem: 'company_context'` explicitly.
- Julien's shell can only see the readonly filtered projection if mounted; denied files are absent.
- Curator agents can manage company files through a policy-granted readwrite runtime binding.
- Search/list/find/grep never leak denied names/snippets/counts, including pagination/limits.
- UI opens `company_context` files readonly for readonly bindings.

## Review gate

Before implementation, each PR plan must pass thermo review for:

- #391 package layering and no permanent agent ownership;
- no path-prefix filesystem inference;
- no denied-file presence in readonly projection;
- no shell/company-context bypass for normal bindings;
- no denied-result leakage;
- no UI identity loss;
- no editable readonly viewer path;
- one PR-sized scope.
