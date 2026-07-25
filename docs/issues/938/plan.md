---
github: https://github.com/hachej/boring-ui/issues/938
issue: 938
state: ready-for-agent
updated: 2026-07-25
flag: not-needed
track: fast
---

# gh-938 Package-owned skills through readonly resource bindings

## Problem

`@hachej/boring-bi-dashboard` ships
`skills/bi-dashboard-authoring/SKILL.md` and declares it in
`package.json#pi.skills`. Package scanning can pass that declaration to Pi, but
direct composition through `createBiDashboardServerPlugin(...)` currently
contributes only its Workspace bridge handler and prompt. A direct/no-provision
host therefore has to know and wire the package installation path itself.

That workaround also leaks a host path across the browser boundary:

1. the Agent skills route currently returns an absolute `filePath` when a
   discovered skill is outside `Workspace.root`; and
2. the Skills pane sends that path to `openFile` without a filesystem identity,
   relying on the temporary readonly global-skill bypass in the primary file
   route.

Copying package skills into `.agents/skills` is not the fix. Copies drift from
the installed package, make direct hosts depend on provisioning, and erase
package ownership.

## Product result

A skill is opened by a logical resource locator, never by a host path:

```ts
// User/workspace-owned
{
  filesystem: "user",
  path: ".agents/skills/healio-reporting/SKILL.md",
}

// Installed package-owned
{
  filesystem: "agent_resources",
  path: "packages/@hachej/boring-bi-dashboard/skills/bi-dashboard-authoring/SKILL.md",
}
```

The Skills pane lists workspace, package, and supported shared/global Pi skill
sources, passes both locator fields through the existing `openFile` command,
and opens external resources read-only. The browser never learns an
installation or home-directory path.

Management identity is `(filesystem, path)`, not frontmatter `name`. Pi remains
the authority for invocation and duplicate-name winner/conflict behavior; the
management UI must not imply a new slash-command namespace.

## Decisions

### 1. Agent owns the skill resource DTO and reserved ID

The Agent API owns the browser DTO and the stable
`"agent_resources"` filesystem ID because this is an Agent discovery contract.
Define the browser-safe Agent type and `AGENT_RESOURCES_FILESYSTEM_ID` constant,
export them from `@hachej/boring-agent/shared`, and expose this additive shape
from the skills route:

```ts
interface AgentSkillResource {
  filesystem: "user" | "agent_resources" | (string & {})
  path: string
}

interface SkillSummary {
  name: string
  description: string
  source?: string
  resource?: AgentSkillResource
  /** Transitional compatibility for workspace-relative user skills only. */
  filePath?: string
}
```

Do **not** add `agent_resources` to
`packages/workspace/src/shared/types/filesystem.ts`. Workspace's generic,
extensible `FilesystemId`, `UiFileResource`, normalization, and key helpers
remain unchanged. Workspace front code either uses a type-only import from
`@hachej/boring-agent/shared` or a Workspace-local structural interface. It
must never import from an Agent `/server` entry, and it has no Agent value
import. `UiBridge.postCommand` remains the only UI dispatch source.

The server never emits an absolute `filePath`. A source that cannot be mapped to
an authorized resource remains visible only through redacted diagnostics and
is not openable.

### 2. Direct plugins declare package ownership; bootstrap stays structural

Add this server-only contribution to the Workspace server-plugin contract:

```ts
interface WorkspacePackageResourceContribution {
  /** Exact package.json name, including npm scope. */
  packageName: string
  /** Package installation root; never serialized. */
  packageRoot: string | URL
}

interface WorkspaceServerPlugin {
  // existing fields unchanged
  packageResources?: WorkspacePackageResourceContribution[]
}
```

`defineServerPlugin` and synchronous `bootstrapServer` perform only structural
validation (non-empty exact package name and path-like root) and preserve the
records plus provenance. They do not call `realpath`, read manifests, scan
skills, create locators, or manufacture Pi/provisioning inputs.

`plugins/bi-dashboard/src/server/index.ts` contributes its own root:

```ts
packageResources: [{
  packageName: "@hachej/boring-bi-dashboard",
  packageRoot: new URL("../../", import.meta.url),
}]
```

The package manifest remains the sole declaration of
`skills/bi-dashboard-authoring`; the factory does not duplicate that path.

### 3. One asynchronous registry canonicalizes direct and scanned sources

Add one focused asynchronous resolver under Workspace server plugin code. It
precomputes one snapshot per composition generation from the complete source
cohort:

- `DefaultPackageManager.resolve().skills` for the effective Pi package set;
- `loadSkills(...)` ambient/default discovery, characterized against the pinned
  Pi version and reduced to individually enumerated canonical skill roots;
- revisioned Workspace plugin-manager snapshots from
  `BoringPluginAssetManager.inspectLoadedPiSnapshot()`;
- bootstrapped direct `packageResources`, with plugin provenance;
- explicit, stable host skill-root contributions already intended for Pi,
  including the workspace-owned skill root (mapped to `user`) and each
  individually enumerated supported shared/global skill root; and
- both Workspace hosts: standalone `createWorkspaceAgentServer` and the CLI
  hub/workspaces path in `packages/cli/src/server/modeApps.ts`.

Arbitrary caller `additionalSkillPaths` without stable provenance remain usable
by Pi but are diagnostic-only and non-openable; they never gain an implicit
mount. Before absolute `filePath` emission ends, every source class above must
have an explicit test and disposition. Folder mode and CLI hub/workspaces mode
ship in the aligned cohort rather than silently leaving package resources
disabled in one host.

It realpaths and merges direct and scanned records by the **same canonical
package root before** projecting paths, locators, management rows, bindings, or
prompts. The same package name at different real roots, or different manifest
names at one claimed root, is a startup error. A package handled by this
registry is excluded from the independent scanned-skill, scanned-runtime-plugin,
and scanned-prompt projections; package/extensions scanning that is outside
this resource concern may continue, but must not re-project the handled skill
or prompt.

The resolved snapshot is atomic:

```ts
interface ResolvedAgentResourceSnapshot {
  generation: string
  /** Absolute, server-only paths supplied directly to Pi. */
  additionalSkillPaths: string[]
  /** Redacted management records keyed by logical resource identity. */
  managedSkills: SkillSummary[]
  locateSkill(filePath: string): AgentSkillResource | undefined
  binding: RuntimeFilesystemBinding // filesystem: agent_resources
  systemPromptAppend?: string
}
```

Initial composition awaits the resolver before Agent construction. Reload runs
the async resolver in `beforeReload` after the plugin manager finishes loading,
then atomically swaps the completed snapshot; Pi's
`getHotReloadableResources()` remains synchronous and only reads that snapshot.
Every callback used for one request/reload captures one snapshot. Locator,
binding, management rows, prompt, Pi paths, and generation must never be mixed
across snapshots. The generation derives from the plugin manager's aggregate
revision (plus deterministic direct/host input fingerprints), never time or
array identity, and every skills-route/projection cache key includes it.

Make the existing seams explicit rather than adding parallel scanners:

- evolve `BoringPluginAssetManager.inspectLoadedPiSnapshot()` to expose the
  revisioned source snapshot, and move/rename its private
  `skillPathForPiLoader` normalization into the registry;
- route `createWorkspaceAgentServer` scan projections
  (`readWorkspacePluginPackagePiSnapshot`, prompt aggregation, and the skill
  portion of `readWorkspacePluginPackageRuntimePlugins`) through or exclude
  them in favor of the registry, so handled packages project once;
- update CLI `modeApps.ts` snapshot synchronization and synchronous `getPi`
  getter to capture the same precomputed generation; and
- make the Agent skills route's `DefaultPackageManager.resolve().skills`
  contribution consume the generation-aware snapshot/cache. Returned errors
  use a stable redacted code/message; raw package-manager/load errors and cache
  keys are never serialized.

Registry output feeds only the host's explicit Pi `additionalSkillPaths`. It
must **not** create `PluginSkillSource`, `WorkspaceServerPlugin.skills`,
`runtimePlugins`, or provisioning contributions, and it never copies resources
into the Workspace.

Prompt composition is deterministic but does not suppress distinct guidance
merely because it came from the same canonical package root. Merge direct and
manifest prompts in normal bootstrap/root order and deduplicate only identical
normalized content. BI's manifest skill-usage guidance and its direct factory
validation prompt are complementary and both appear once; alternatively, the
direct prompt may absorb the manifest guidance and exact-content deduplication
then removes the duplicate. Silent root-based suppression is forbidden.
Caller/host prompt composition outside package scanning keeps its existing
precedence.

### 4. Normalize declarations before projection

For each manifest `pi.skills` entry, reject absolute, empty, non-normalized,
missing, or escaping declarations, then normalize the two forms Pi supports:

- a directory declaration resolves to `skillRoot=<directory>` and
  `skillFile=<directory>/SKILL.md`;
- a `SKILL.md` declaration resolves to `skillRoot=<parent>` and
  `skillFile=<declared file>`.

Both forms produce the same canonical locator and management identity for the
same skill. Keep `skillFile`, confined `mountRoot`, and Pi-facing
`piSkillPath` as distinct normalized fields: the pinned Pi loader may require a
collection parent while the readonly mount is only the individual `skillRoot`.
`piSkillPath` and `mountRoot` therefore may differ. Register only the complete
individual `skillRoot` so relative references inside the skill remain readable,
but do not expose siblings outside it.

Package locators use
`packages/<exact-package-name>/<manifest-relative-skill-file>`. Supported
shared/global Pi skills use an explicit stable mount such as
`shared/pi-agent/<enumerated-skill-id>/SKILL.md`. Each mount admits only an
enumerated canonical skill root: `getAgentDir()` itself is never a mount or an
allowed root. Ambient absolute discovery does not authorize its parent tree.
Scoped package names are matched from the registry mount table, not guessed
from request path segments.

### 5. Implement a confined readonly multi-root adapter

Implement the adapter in `@hachej/boring-bash/server` beside
`readonlyProjectionOperations.ts`. Match the actual contracts: the
`RuntimeFilesystemBindingOperations` object implements required `read`, `list`,
`find`, `grep`, `stat`, and `rejectMutation` and omits optional `write`,
`delete`, `move`, and `mkdir`; `access: "readonly"` is set on the enclosing
`RuntimeFilesystemBinding`, not on operations. Existing file-route and tool
binding logic rejects mutations from binding access/missing operations; do not
add mutation implementations or a second rejection protocol.

The adapter enforces:

- exact filesystem ID `agent_resources`;
- normalized forward-slash logical paths only;
- no absolute paths, null bytes, backslashes, empty/`.`/`..` segments,
  percent-decoded traversal/separators, URL schemes, drive prefixes, or
  embedded filesystem prefixes;
- exact registered mount-prefix selection;
- lexical containment followed by canonical-target containment for every
  operation and every returned search/list entry;
- only manifest-declared or explicitly registered supported skill roots; and
- stable not-found-or-denied errors and metadata containing logical paths only.

Safe symlinks are allowed when the package root and every resolved target remain
inside the canonical registered skill root. Package-manager symlinked install
roots are realpathed at admission, with a compatibility test using a real
repository/pnpm-linked package rather than only synthetic fixtures. Escaping
root/intermediate/file/directory symlinks fail closed. This design assumes
admitted package trees are trusted, immutable boot artifacts for the lifetime
of a snapshot; writable or adversarially changing package trees require a
stronger descriptor/openat-style design and are a stop condition, not a TOCTOU
promise made by this issue.

Reuse the existing conformance utility at
`packages/boring-bash/src/server/testing/readonlyProjectionConformance.ts` and
extend its subject/probes only as generically necessary for a multi-root
readonly projection.

### 6. Compose registry paths and bindings without provisioning

The registry is a host resource binding:

- it works in direct mode and with provisioning disabled;
- it reads trusted installed/shared sources in place;
- local/sandbox Workspace selection does not alter logical identity;
- a remote Agent runtime may receive host-selected skill content through Pi
  while browser reads remain served by the host binding; and
- no `.agents/skills` or `.boring-agent/skills` copy is created.

Slice 938.1 ships a pure generic filesystem-binding uniqueness function and
full input matrix only. Every filesystem ID must occur once; array order never
decides authority. After rebasing onto #939, slice 938.2 installs its single
final call site over the complete request-scoped binding list immediately
before Agent/file-route use. The same small function/seam is shared with #942;
this issue does not create an issue-specific binding policy framework.

PR #939 is still responsible for Agent Host composition and request scoping.
Because its final files and callbacks can change, rebase onto #939 first and
inventory the actual integration seams before implementing 938.2. Expected
candidates are `createWorkspaceAgentServer`, Agent route registration/scope
construction, the skills-route options, and the request-scoped file-binding
resolver, but this list is not a promise of exact filenames or callback names.
If the rebased seams cannot provide one atomic snapshot generation to both
skill locator and binding resolution, stop and amend the plan rather than wire
parallel callbacks.

### 7. Preserve management source identity without overriding Pi

Slice 938.0 adds a characterization against the repository's **pinned Pi
version** before implementation design freezes: load same-named workspace and
package skills through the exact planned `additionalSkillPaths` order and
record whether `loadSkills(...)` retains both source records or collapses by
name. It also records the exact ambient/default roots and source metadata Pi
returns for this version.

- If Pi retains both, map each returned source through the registry/workspace
  locator and key management rows by resource identity.
- If Pi collapses them, do not fork or override Pi's invocation behavior. Build
  the management response as a resource-identity union of Pi's invocation
  summaries and the registry's separately enumerated, redacted management
  sources. The UI lists those registry sources as management rows even though
  Pi remains the authority for which same-name skill is invocable.
- If the pinned behavior exposes neither sufficient source paths nor a stable
  winner that can be represented without claiming false invocability, stop and
  amend before implementation.

The registry reads management metadata from each admitted canonical
`SKILL.md`; it does not key or deduplicate by `name`. Workspace resources map to
`{ filesystem: "user", path: <workspace-relative-posix> }`; registered package
and shared/global resources map to `agent_resources`; all other absolute
sources get no locator and are never serialized.

The Skills UI uses the generic `uiFileResourceKey(resource)` for openable row
identity, with a redacted source plus ordinal fallback for non-openable
diagnostics, sorts by name then resource identity, and calls:

```ts
postUiCommand({
  kind: "openFile",
  params: {
    filesystem: skill.resource.filesystem,
    path: skill.resource.path,
    mode: "view",
  },
})
```

## Compatibility and migration

1. **Additive DTO and complete source cohort in 938.2.** Before stopping
   absolute `filePath` emission, inventory and test the disposition of
   `DefaultPackageManager.resolve().skills`, `loadSkills` ambient/default
   discovery, Workspace plugin-manager snapshots, direct `packageResources`,
   explicit host roots, standalone Workspace host, and CLI hub/workspaces host.
   Register safe locators for every supported package/shared/global root in
   both hosts. Continue emitting `filePath` only for workspace-relative `user`
   skills during one aligned package cohort; never emit it for
   package/shared/global resources.
2. **Strict browser fallback in 938.3.** Prefer `resource`. Accept a legacy
   `filePath` only when it is a non-empty, forward-slash, browser-safe relative
   path: no leading slash, backslash, null byte, URL/drive prefix, empty/`.`/`..`
   segment, or percent-decoded separator/traversal. Convert only that form to
   `{ filesystem: "user", path: filePath }`; otherwise disable opening.
3. **Direct/scanned convergence.** BI contributes `packageResources`; scans and
   direct contributions merge in the canonical async registry. Consumers need
   neither a package-path option nor provisioning.
4. **Bypass retirement in 938.4 only.** Once 938.2 and 938.3 are deployed,
   #942.3 is complete, and an inventory proves every supported shared/global
   source has a locator, delete `readonlySkillFiles` and its primary-route
   branches. 938.4 adds no new source class or locator.
5. **Later DTO cleanup.** Remove relative-user `filePath` only after the release
   cohort no longer needs it.

The exact legacy predicate inventory is intentionally narrow and must be tested
before deletion: `isReadonlySkillFilePath` accepts an absolute path only when it
has no null byte or `..` segment, ends in `/SKILL.md`, and contains both
`/.pi/agent/` and `/skills/`; the primary file/stat branches then confine it
against `[workspace.root, getAgentDir()]`. This inventory is descriptive, not a
new authorization rule. #942 must preserve these branches through #942.3 while
it changes binding or primary-filesystem policy. #938 exclusively removes the
predicate, exports/tests, both route branches, and the `getAgentDir()` allowed
root in 938.4. After removal, a `user` request uses the configured primary
binding/policy-aware Workspace path supplied by #942, or the existing Workspace
fallback; neither path may regain an absolute outside-workspace exception.

Older fronts safely render external rows without an open path when paired with
the additive server. New fronts continue opening safe relative user skills from
an older server. Package/shared opening requires the aligned
Agent/Workspace/Boring Bash/front cohort.

No persisted data changes. Existing materialized copies remain ordinary user
files and are not deleted or rewritten.

## Test seams

### Pinned-Pi source-retention gate (slice 938.0)

Before freezing implementation design, test the pinned Pi package with
same-name workspace and package fixtures and the production
`additionalSkillPaths` ordering. Capture whether results retain or collapse
source records, the stable winner/order, the `filePath`/`sourceInfo` retained,
and the exact ambient/default root behavior. Check in the fixture and expected
characterization; a Pi upgrade must rerun it. Later slices exercise only the
management-union branch selected by this evidence and do not redefine Pi
invocation semantics.

### Manifest, merge, and prompt coverage

- BI's direct factory contributes package identity/root plus its existing
  bridge/prompt, without duplicating the manifest skill path;
- synchronous bootstrap performs structural validation only;
- the async registry rejects manifest-name mismatch, duplicate package identity
  at different real roots, missing declarations, and escapes;
- direct plus scanned records for one real root produce one normalized skill,
  one confined mount, one locator, and the pinned-Pi `piSkillPath` (which may
  differ from the mount root);
- directory and `SKILL.md` declarations normalize identically;
- scanned-only manifest prompts appear once; BI's complementary manifest
  skill-usage and direct validation prompts both appear once, with only
  normalized identical content deduplicated; and
- handled packages do not appear in independent scan skill/runtime/prompt
  projections.

### Readonly resource adapter

Use fixture packages/shared roots with a skill, nested reference, sibling
non-skill file, confined symlinks, and escaping symlinks. Prove:

- read/stat/list/find/grep work only below registered skill roots;
- scoped and unscoped names map without ambiguity;
- safe in-root symlinks work while escaping root/intermediate/target symlinks
  fail closed;
- absolute, traversal, encoded traversal, null-byte, drive/URL/filesystem-prefix,
  unknown-mount, and undeclared-file requests fail closed;
- errors, diagnostics, logs exposed to callers, cache/debug output, and
  metadata contain only stable codes and logical paths, never host roots;
- negative reads for adjacent Pi settings, model/provider configuration, and
  credential fixtures fail even though the skill is readable, proving that
  neither `getAgentDir()` nor a package collection root was mounted;
- a real repository package-manager symlink resolves and reads confined skill
  content without widening the admitted root;
- optional mutation methods are absent, `access` is readonly on the binding
  (not operations), and existing
  route/tool mutation handling returns the stable readonly response; and
- the generic final binding check rejects duplicate `agent_resources` and all
  other duplicate filesystem IDs.

Run the actual `readonlyProjectionConformance` utility rather than inventing a
skill-specific substitute.

### Discovery API and UI

- the complete source cohort (package-manager resolution, ambient/default,
  plugin-manager snapshot, direct package resource, and explicit host root) in
  standalone and CLI hub/workspaces hosts returns exact safe locators and no
  host/home path;
- unregistered outside sources have neither locator nor absolute `filePath`;
- `beforeReload` precomputes asynchronously, atomically swaps after success,
  and serves the synchronous Pi getter; plugin-manager revision changes the
  generation and cannot combine a retired locator with a new binding;
- the characterized same-name path returns distinct management resource keys
  without changing Pi invocation semantics;
- UI clicks emit exact `openFile` commands including filesystem;
- strict relative legacy fallback opens as `user`, while absolute, URL/drive,
  backslash, dot-segment, and encoded-traversal fallbacks are disabled; and
- rows have stable unique keys and no React collision; and
- the skills-route cache is generation-scoped and package-manager/loader
  failures return a stable redacted response with no raw path-bearing message.

### Highest integration seam

After rebasing onto #939 and recording its actual callback/file inventory,
run the same guarded proof through both `createWorkspaceAgentServer` and CLI
hub/workspaces `modeApps.ts`, using the real BI factory, a temporary empty
Workspace, direct/no-provision mode, and no copied BI skill. Exercise
`GET /api/v1/agent/skills` and the existing Files API to prove:

1. BI discovery returns the exact package locator;
2. discovery, errors, and operation metadata expose no host root;
3. the packaged `SKILL.md` and nested resources read as readonly;
4. all mutation routes reject the binding through existing behavior;
5. a same-name workspace skill remains a separate management resource under the
   pinned-Pi branch; and
6. arbitrary absolute `user` paths remain rejected; and
7. Pi settings/model credential siblings are unreachable and every public
   error/diagnostic is redacted.

## Slices

### Slice 938.0 — Pinned-Pi source-retention characterization

**Delivers:** a checked-in same-name workspace/package fixture against the
repository's pinned Pi version; exact production `additionalSkillPaths` order;
retained/collapsed source records, winner, `filePath`/`sourceInfo`, and
ambient/default root inventory; and the selected management-union expectation.
This evidence lands before implementation design freezes and changes no runtime
behavior.

**Blocked by:** None.

**Proof:** the narrow pinned-Pi characterization test and recorded fixture
expectation; rerun is mandatory on Pi upgrades.

**Review budget:** One test-only PR.

### Slice 938.1 — Agent contract, registry, and confined adapter

**Delivers:** Agent shared DTO/ID export; structural package-resource
contribution; async canonical registry contract and declaration normalization;
readonly multi-root adapter; the **pure generic** binding-ID uniqueness function
and its full matrix (not its final host call site); and
confinement/conformance/redaction tests. Workspace's generic filesystem contract
stays unchanged.

**Blocked by:** 938.0.

**Proof:** Agent/Workspace/Boring Bash unit, type, and build gates plus merge,
normalization, traversal, real-package symlink, credential-negative, mutation,
redaction, and pure uniqueness matrices.

**Review budget:** One focused contract/security PR; no #939 host integration.

### Slice 938.2 — Complete discovery and host composition

**Delivers:** BI package-root contribution; canonical direct+scan merge with
complementary prompt content preserved; precomputed revision-derived registry
swaps and synchronous Pi getter; the post-#939 final binding-uniqueness call
site; the complete source cohort and package/shared/global locators in both
standalone and CLI hub/workspaces hosts; the 938.0-selected management fallback;
generation-aware route caching/redaction; and the end of absolute `filePath`
emission.

**Blocked by:** 938.0, 938.1, and a rebase/integration inventory against the
final #939 composition seams. Do not add this work to #939.

**Proof:** real BI direct/no-provision fixture in both host paths, explicit
package-manager/ambient/plugin/direct/host-root fixtures, no copied skill, no
absolute browser path, one projection per real root, prompt-content dedupe, and
same-name management preservation under the pinned behavior.

**Review budget:** One focused host-integration PR; keep adapter/DTO work in
938.1 and UI rendering work in 938.3.

### Slice 938.3 — Skills UI migration

**Delivers:** structural resource DTO consumption, filesystem-preserving
`openFile`, identity-safe row keys/sorting, strict browser-safe relative legacy
fallback, distinct registry management rows, and same-name UI tests.

**Blocked by:** 938.2 DTO/management response.

**Proof:** front unit tests plus guarded click/read proof for user, package, and
shared/global resources.

**Review budget:** One small UI PR or the aligned package cohort of 938.2.

### Slice 938.4 — Legacy bypass retirement only

**Delivers:** deletion of `readonlySkillFiles`, its exports/tests, and its
primary file/stat route branches; proof that post-#942 configured primary
binding/policy-aware Workspace or the Workspace fallback rejects absolute
outside-workspace `user` paths. It does not add locators or registry sources.

**Blocked by:** 938.2–938.3 deployed together, **942.3 complete**, and an
inventory proving no supported source still depends on the bypass. #942.3 must
preserve it until this slice.

**Proof:** shared/global regressions already use their 938.2 readonly locators;
absolute-path rejection matrix; no references to
`readonlySkillFiles`/`isReadonlySkillFilePath` remain.

**Review budget:** One narrow security cleanup PR.

## Rollout and rollback

No runtime feature flag or stored-state migration is required. Roll out the
aligned Agent, Workspace, Boring Bash, BI, and front package cohort in slice
order. Keep the legacy bypass unchanged through 938.3; #942.3 also preserves it.
Do not broaden it to package paths.

Rollback before 938.4 removes or ignores package-resource contributions;
external rows become non-openable on older cohorts while user behavior
continues. Rollback after 938.4 requires the prior aligned package cohort to
restore the bypass. Neither direction copies, deletes, or rewrites workspace
data. If identity, confinement, or atomic generation proof fails, disable the
resource registration rather than route an external path through `user`.

## Acceptance

1. Direct `createBiDashboardServerPlugin(...)` composition discovers the
   manifest-declared BI skill without downstream path wiring or provisioning.
2. The Agent skills API returns exact safe user/package/shared locators across
   the complete source cohort and both standalone/CLI hosts, with no absolute
   installation or home path.
3. The canonical async registry merges all admitted records before projection,
   is precomputed in `beforeReload`, derives generation from plugin-manager
   revision, and serves a synchronous Pi getter.
4. Directory and `SKILL.md` declarations normalize to one skill identity while
   preserving distinct Pi loader path and confined mount root where required.
5. Same-name management sources remain separately addressable under the pinned
   Pi behavior without changing Pi invocation authority.
6. `agent_resources` is readonly at the binding, confined to enumerated
   canonical skill roots (never `getAgentDir()`), supports real package-manager
   symlinks, rejects escapes/mutations/settings/model credentials, and strictly
   redacts host paths.
7. Direct/no-provision mode reads installed resources in place and creates no
   Workspace copy.
8. Workspace's generic `FilesystemId` contract stays unchanged and Workspace
   front/shared code adds no Agent value import.
9. Locator and binding generation is atomic; 938.1 proves the pure generic
   uniqueness function and 938.2 installs its final post-#939 call site through
   the seam shared with #942.
10. 938.2 supplies every supported shared/global locator before absolute
    `filePath` emission ends; 938.4 only removes the bypass.
11. Post-removal `user` routing uses the #942 configured primary
    binding/policy-aware Workspace or Workspace fallback and rejects every
    arbitrary absolute/outside-workspace path.
12. PR #939 and #942 retain their own scopes; #942.3 preserves the legacy
    bypass and 938.4 is explicitly blocked on 942.3.
13. BI's manifest skill-usage and direct validation prompts remain
    complementary and each appears once unless identical content is deduped.

## Out of scope

- copying or synchronizing package skills into `.agents/skills`;
- writable package/shared resources;
- exposing arbitrary package files, home-directory files, or all of
  `node_modules`;
- changing Pi slash-command duplicate-name semantics;
- adding Agent Gateway resource methods or remote Host transport;
- changing Workspace's generic filesystem ID contract;
- an issue-specific binding-policy framework;
- mutable/untrusted package-tree support;
- widening #939 composition/session work or #942 policy work; and
- a general package asset browser or marketplace.

## Stop conditions

Stop and amend instead of improvising if:

1. the pinned Pi feasibility test exposes neither sufficient source identity nor
   a safely representable stable winner for same-name management rows;
2. direct and scanned registration resolve one package identity to different
   real roots;
3. a browser DTO, UI command, browser-facing error, or operation metadata would
   contain an absolute host path;
4. package/shared opening requires a Workspace copy, a `user` exception,
   `PluginSkillSource`, runtime plugin, or provisioning projection;
5. a trusted immutable package-tree assumption is false, or confined symlinks
   cannot be enforced by canonical-target checks;
6. after rebasing #939, locator and binding callbacks cannot capture the same
   atomic registry generation;
7. the final binding list cannot be checked once for generic filesystem-ID
   uniqueness through the seam shared with #942; or
8. implementation would require #939 Gateway/session expansion, #942 bypass
   removal, or a change to Pi invocation semantics.

## Proof commands

Implementation PRs run narrow package gates first, then affected repository
invariants:

```bash
pnpm --filter @hachej/boring-bash typecheck
pnpm --filter @hachej/boring-bash test
pnpm --filter @hachej/boring-bash build
pnpm --filter @hachej/boring-agent typecheck
pnpm --filter @hachej/boring-agent test
pnpm --filter @hachej/boring-agent build
pnpm --filter @hachej/boring-workspace typecheck
pnpm --filter @hachej/boring-workspace test
pnpm --filter @hachej/boring-workspace build
pnpm --filter @hachej/boring-bi-dashboard typecheck
pnpm --filter @hachej/boring-bi-dashboard test
pnpm --filter @hachej/boring-bi-dashboard build
pnpm lint:invariants
```

Planning/documentation proof:

For the committed planning PR (not an uncommitted working-tree diff):

```bash
git diff --check HEAD^ HEAD
changed="$(git diff-tree --no-commit-id --name-only -r HEAD)"
test "$changed" = "docs/issues/938/plan.md"
test -z "$(git diff --cached --name-only)"
rg -n '938\.0|DefaultPackageManager|loadSkills|inspectLoadedPiSnapshot|modeApps|generation|942\.3|readonlySkillFiles|Stop conditions' \
  docs/issues/938/plan.md
```
