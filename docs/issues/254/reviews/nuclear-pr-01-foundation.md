# Nuclear review — PR 01 foundation plan

Plan reviewed: `prs/01-foundation.md`

Verdict: **revise before implementation**

The PR is directionally right, but the plan still leaves too much room for spaghetti in the actual implementation. The biggest risk is turning “source metadata” into a half-explicit, half-inferred trust model scattered across scan, asset manager, reload, and future install code.

## Blockers

### 1. `runtimeBackendAllowed: boolean` is a drift-prone policy leak

The plan says not to infer trust from paths, good. But storing `runtimeBackendAllowed` directly on every source record creates another failure mode: every caller now has to set the boolean correctly. That becomes the same bug class as path inference, just one layer later.

Better shape:

```ts
type BoringPluginSource = {
  rootDir: string
  origin: "workspace" | "global" | "app" | "additional"
  installKind?: "extension" | "npm" | "git" | "local-path"
  workspaceId?: string
}

function canActivateRuntimeBackend(source: BoringPluginSource, ctx: WorkspacePluginPolicyContext): boolean
```

If you really want a stored capability, make it produced by exactly one source-normalization function, not passed around as arbitrary caller input.

Required plan change: define a **single policy function / normalizer** as owner of backend activation, not an ad-hoc boolean set at callsites.

### 2. The source enum is prematurely polluted by install concepts

PR 01 does not implement install, but the source model already includes `npm-package`, `git-package`, and `local-path`. That invites code branches for install kinds before install exists.

Code-judo move: split provenance from install mechanism:

```ts
origin: "workspace" | "global" | "app" | "additional"
installKind?: "extension" | "npm" | "git" | "local-path"
```

Then PR 01 can use only origins that exist today. PR 03 can populate `installKind`.

Required plan change: avoid future-only enum values in PR 01 execution path unless tests prove they are inert metadata only.

### 3. “No behavior change” conflicts with `opts.beforeReload` error wrapping

The plan says reload coordinator extraction is behavior-preserving, but also says to wrap caller `opts.beforeReload` failures into diagnostics. If current behavior aborts or throws differently, that is a behavior change and should not be inside the extraction PR.

Required plan change: choose one:

- strict extraction: preserve caller hook failure behavior exactly; or
- behavior change: explicitly include it, test it, and stop calling the PR behavior-preserving.

I recommend strict extraction in PR 01. Move caller-hook diagnostic changes to PR 02 with backend diagnostics.

### 4. Source records need canonical path normalization rules

The plan uses `root: string`, but does not say whether it is absolute, realpathed, symlink-preserving, workspace-relative, or display-only. This is security-sensitive because later gateway policy depends on it.

Required plan change:

- rename to `rootDir`;
- require absolute normalized path;
- define whether realpath is used for containment checks;
- keep a separate display/source string if needed for CLI output.

### 5. Asset manager ownership boundary is not explicit enough

PR 01 touches metadata that likely flows through `BoringPluginAssetManager`, which is already 488 lines and owns too much scan/signature/event state. The plan must prevent adding policy logic there.

Required plan change: explicitly state:

- asset manager may carry source metadata through loaded/list/inspect records;
- asset manager must not decide backend activation policy;
- asset manager must not import runtime backend modules;
- asset manager must not grow install/source ordering logic.

## Strong recommendations

### A. Add one type boundary file instead of sprinkling types

Create one source metadata module, e.g.:

```txt
packages/workspace/src/server/agentPlugins/pluginSources.ts
```

Own there:

- source record type;
- normalizer;
- ordering/shadowing helper if needed;
- runtime backend policy function.

Do not define source records in multiple files.

### B. Keep reload coordinator extraction tiny

`createWorkspaceAgentServer.ts` is already ~801 lines. This PR should shrink it or keep it flat. If the PR adds more inline conditionals there, reject it.

Coordinator should be called through one clear function, not several optional callback branches.

### C. Tests need “same observable behavior” snapshots

The test list is good but missing a key guard: before/after reload endpoint output should remain byte/shape-compatible for existing callers. Add snapshot/shape tests for current reload response.

## Suggested revised acceptance

- Source metadata has one canonical module and one policy function.
- `rootDir` is absolute and path-normalization rules are documented/tested.
- `BoringPluginAssetManager` only carries source metadata; it does not own backend activation policy.
- Reload coordinator extraction preserves caller-hook error behavior exactly.
- `createWorkspaceAgentServer.ts` does not grow and preferably shrinks.
- Jiti helper extraction has no behavior change for current `boring.server` diagnostics.
