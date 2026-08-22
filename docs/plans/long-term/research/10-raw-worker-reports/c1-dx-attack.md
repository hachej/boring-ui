# Finding 1 — Five startup lines are not five decisions removed

**Verdict: WRONG**

The proposed banner is a useful diagnostic serialized into the wrong channel, at the wrong frequency, with the wrong claim. It does not remove six decisions. It reports
five outcomes after the product has already made them. That distinction matters when an outcome changes security, scope, latency, or persistence.

## Evidence

The current folder-mode CLI already prints a five-field startup block. `packages/cli/src/server/cli.ts:169-188` prints:

```text
<project>
  workspace  <path>
  mode       <mode>
  port       <port>
  host       <host>

  starting http://localhost:<port> …
```

The proposal is therefore not a new discoverability mechanism. It is an expansion and renaming of an existing startup banner. The study's actual CLI run observed that
block. It also observed three warnings before bind failure. The study offers no user evidence that adding sandbox, plugin tier, session root, and model to this block
improves comprehension. The claim “five lines replace six decisions” is unfalsifiable as filed. No comprehension test, recall test, override-discovery test, or
repeated-run test exists. The information value decays sharply after the first successful run. The cost does not decay. Every restart, process-manager retry, test boot,
dev-server reload, and CI invocation would repeat the same choices. In CI, those lines are not teaching. They are log volume. In a supervisor restart loop, they are
duplicated noise. In a command whose stdout is parsed, they are corruption. In a JSON mode, any human banner on stdout breaks the contract. The CLI already parses
`--json` for plugin-oriented commands in `packages/cli/src/server/cli.ts:274-293`. That makes a blanket “print every choice” rule incompatible with an existing
structured-output axis. The proposal does not specify stdout versus stderr. It does not specify TTY detection. It does not specify `CI` behavior. It does not specify
quiet mode. It does not specify daemon/service mode. It does not specify whether unchanged choices print on every hot restart. It does not specify whether credentials
disclose provider/model provenance beyond what operators intended logs to reveal.

## What the peers actually print

### OpenCode

OpenCode's default `opencode` command starts a full-screen TUI. It does not emit a persistent five-line resolved-configuration banner into ordinary scrollback. Its
configuration is rendered inside the interactive product surface. The TUI exposes model/provider state contextually and replaces the home screen with provider setup when
the provider list is empty. Headless `opencode run` prints `> <agent> · <modelID>` only in formatted human output; its `--format json` branch bypasses that heading and emits
NDJSON events on stdout. `opencode serve` prints only an applicable security warning and the listening address. Debug logs are opt-in through `--print-logs` and log-level
selection. This mode-aware behavior is the opposite of “print every resolved choice on every start” (`packages/opencode/src/cli/cmd/run.ts:643-730`, `serve.ts:4-19`).

### Flue 2.0.3

The study actually ran `flue run` far enough to load the agent and attempt the model. Exact installed 2.0.3 source shows it prints a roughly five-row operational block:
agent, conversation id, config path, database, and environment, then the user message (`dist/flue.js:1870-1903`). It then printed the actionable provider error:

```text
Provider is not configured: google
```

These are run facts, not five silently inferred policy choices. Flue sends its presenter/status stream to stderr and the final reply to stdout. Under `--json`, stdout becomes
one JSON envelope, but the status rows still go to stderr (`dist/flue.js:1835-1857,1870-1957`; `docs/cli/run.md:33-54`). Thus Flue preserves parseable stdout but demonstrates
exactly how repeated status rows can spam captured CI stderr; it has no `run --quiet`. For HTTP, Flue delegated serving to Vite, which printed environment/listener output.

### eve 0.31.3

The study did **not** run eve startup. It reached only the package's Node guard:

```text
eve requires Node.js >=24. You are running v22.22.1. Please install a compatible Node.js version and try again.
```

That is excellent targeted startup output: requirement, actual value, remedy. Any issue comment implying the study observed eve's normal `dev` banner is wrong. Source
inspection of the exact tarball shows `eve dev` uses a transient build row and then a full-screen TUI; headless mode prints a tagged listening URL and possibly one UI-disabled
warning. `eve invoke` is deliberately TUI-free and emits one JSON result. Eve also supplies the counterexample that proves suppression needs tests: a global pre-action hook
prints the wordmark for `info`, `dev`, and `init` without checking `--json`, so `eve info --json` is banner plus JSON on the same logger and is not directly parseable
(`dist/src/cli/run.js`, `commands/info.js`). The honest conclusion is not that peers prove banners are bad. It is that no peer validates the proposed blanket rule, and Eve
shows how cosmetic output escapes into machine modes when suppression is not centralized.

## Replacement recommendation

Keep a concise interactive startup summary, but make its contract explicit. Print it only for an interactive folder launch when stderr is a TTY. Print it to stderr, never
structured stdout. Suppress it automatically for `--json`, piped stdout, non-TTY stderr, `CI`, tests, daemon/service mode, and process-manager child mode. Add `--verbose`
or `boring-ui explain` for the full resolution ledger. Add `--quiet` for callers who want only fatal diagnostics. On ordinary startup, retain only actionable/high-value
fields:

```text
workspace  /exact/path
server     http://127.0.0.1:5200
runtime    direct  (use --mode local-sandbox for bwrap isolation)
```

Show session-root, plugin-tier, and auth-source detail only when surprising, overridden, unavailable, unsafe, or requested with `--verbose`. Never print secret values.
For JSON, return one versioned object containing resolved values and provenance. Test byte-for-byte stdout purity in structured mode.

# Finding 2 — “Print the choice” fails exactly where determinism matters

**Verdict: WEAK**

Visibility is sound. Unconditional prose output is not.

## Evidence

A resolved value needs machine-readable provenance to be useful in automation. “sandbox bwrap (detected)” omits which executable was detected, whether provisioning
succeeded, whether the network is available, and which fallback occurs after failure. “model anthropic/claude-…” can be stale between registry construction and first
turn. “plugins runtime tier” is not one choice at all when internal defaults and workspace-local plugins coexist. “sessions ~/.pi/agent/sessions” is misleading when
`BORING_AGENT_SESSION_ROOT`, an explicit session root, host durable storage, or namespace projection applies. The current workspaces-mode code deliberately avoids the
auth scan at startup. `packages/cli/src/server/cli.ts:206-210` says importing Pi's model registry after listen can block the event loop and delay the first workspace
assets. A banner that promises resolved model/auth state either repeats that latency regression or prints a shallow/stale answer.

## Replacement recommendation

Define one `ResolvedLaunchConfig` structure with value, source, confidence, and warnings. Use it for `doctor --json`, `explain --json`, and optional interactive
rendering. Do not make log prose the source of truth. Do not claim a value is resolved until the component that owns it has resolved it.

# Finding 3 — Raw writes to Pi's auth file cross an ownership boundary

**Verdict: WRONG**

The same-terminal onboarding goal is sound. The proposed implementation is not.

## Evidence

`packages/agent/src/server/harness/pi-coding-agent/createHarness.ts:575-580` states the ownership decision explicitly:

```text
Auth/model credentials are Pi-owned.
Boring does not pick a provider credential itself.
```

`packages/cli/docs/README.md:134` records the same boundary. Boring currently reads through Pi's exported `AuthStorage.create()`. It does not parse or merge Pi's file
itself. The path is not universally `~/.pi/agent/auth.json`. The pinned Pi package resolves its agent directory through Pi configuration, including `PI_CODING_AGENT_DIR`,
before falling back to `~/.pi/agent`. Hard-coding the fallback would write the wrong file for a supported relocated store. The current schema is not a provider-to-string
map. It is provider to either:

```ts
{ type: "api_key", key: string, env?: Record<string, string> }
```

or:

```ts
{ type: "oauth", ...OAuthCredentials }
```

Pi has already migrated legacy OAuth/settings data into this store. Its changelog records schema evolution from `type: "api-key"` to `type: "api_key"` and provider-scoped
environment support. That is direct evidence that copying today's JSON shape creates upgrade coupling. A naive write can overwrite an OAuth credential for the same
provider. It can also discard provider-scoped environment metadata. Pi's storage backend creates the parent directory with mode `0700`. It creates and chmods the
credential file to `0600`. It uses `proper-lockfile`. It re-reads under the lock. It merges only the selected provider while preserving other providers. It coordinates
OAuth refreshes across Pi instances. A Boring-owned `readFile`/`writeFile` merge would bypass these guarantees. Even the current Pi implementation writes in place rather
than temp-and-rename. It is lock-aware but not crash-atomic. Boring should not clone it and create a second, weaker writer.

## Replacement recommendation

Never edit Pi's JSON directly. If persistence is supported, call the pinned package's public `AuthStorage.set(provider, { type: "api_key", key })`. Respect Pi's resolved
store location. Fail closed on a malformed or unreadable existing store. Require confirmation before replacing an OAuth credential. Add compatibility tests against every
supported pinned Pi version. Prefer an exported Pi login/setup flow if Pi exposes one.

# Finding 4 — A literal `--api-key` is a secret-exposure feature

**Verdict: WRONG**

## Evidence

`boring-ui --api-key sk-...` places the secret in shell history. It places the secret in the process argv. On common systems that is visible through `ps` and
`/proc/<pid>/cmdline` to the same principal and sometimes broader process observers. Quoting does not prevent either leak. Wrapper scripts and CI runners often echo
commands. Crash reporters can capture argv. Shell audit tooling can capture argv. The repository's logger redaction cannot sanitize data before Boring receives it. It
cannot edit shell history. It cannot edit process listings. The pinned Pi CLI has a `--api-key`, but Pi treats it as a non-persistent runtime override.
`AuthStorage.setRuntimeApiKey()` is explicitly documented “not persisted to disk.” The issue silently changes that familiar semantic into durable global mutation. The
flag is also ambiguous without a provider. Keys do not have a universal prefix from which a provider can be inferred safely. Custom providers make inference impossible.
Model selection remains unresolved after key entry.

## Replacement recommendation

For automation, document provider-native environment variables and secret-manager injection. For ephemeral launch overrides, require an explicit provider/model and accept
`--api-key-stdin` or `--api-key-file`. Feed that value to `setRuntimeApiKey()` and never persist it. Do not recommend literal key argv in CI examples. For interactive
setup, use a hidden/no-echo prompt in the same terminal. State explicitly when persistence will update Pi's user-global store. Never print, log, interpolate into errors,
or serialize the value.

# Finding 5 — Delegating to `pi /login` was deliberate, but the current handoff is broken

**Verdict: WEAK**

The boundary is sound. The second-terminal experience and refresh instruction are weak.

## Evidence

Pi owns live provider discovery. Pi distinguishes API-key providers from subscription/OAuth providers. Pi owns OAuth callbacks, token refresh, locking, logout,
migrations, provider-specific metadata, and model/default refresh. Its `/login` flow derives choices from the live registry rather than a Boring-maintained list. The
study missed all of this when it reduced the handoff to “populate a JSON file.” However, `packages/cli/src/server/cli.ts:127-138` tells the user to authenticate in
another terminal and then refresh the browser. That final instruction is not reliable. `packages/agent/src/server/http/routes/models.ts:64-73` creates a process-cached
`AuthStorage` and `ModelRegistry`. Pi's stored credential data is loaded into memory. `hasAuth()` does not reload the file before answering. A browser refresh therefore
does not necessarily make an external `pi /login` write visible to the running server. This is a concrete product bug, not just aesthetic friction.

## Replacement recommendation

Keep Pi as the authority. For subscriptions, invoke a supported Pi login API or a same-terminal targeted child process. After completion, explicitly reload or recreate
every affected auth storage and registry. For API keys, offer the hidden prompt only in interactive folder mode. Never prompt when stdin/stderr are not TTYs, `CI` is set,
structured output is requested, or the command is a service/workspaces launch. For non-interactive use, emit a stable diagnostic to stderr and document env injection.

# Finding 6 — The four layers are a marketing diagram, not the product topology

**Verdict: WRONG**

Progressive entry points are good. A single L0→L1→L2→L3 total order is false for this system.

## Evidence

The repository already has an “L1.5.” Environment variables coexist with flags: `PORT`, `HOST`, `BORING_MODE`, `BORING_AGENT_WORKSPACE_ROOT`, `BORING_AGENT_SESSION_ROOT`,
provider env vars, and host deployment variables. Interactive credential setup is another control surface. Subcommands are another. Workspace registry state is another.
User-global Pi configuration is another. The proposal does not define precedence across them. A config file cannot encode every next step. It can name a module. It cannot
replace module behavior. `packages/workspace/docs/PLUGIN_SYSTEM.md:43-60` states that runtime plugins are route-free and cannot receive backend services, runtime
bindings, or raw paths. `PLUGIN_SYSTEM.md:413-418` states dynamic providers/bindings are not mounted and `boring.server` is not dynamically registered. Those are
architectural cliffs, not missing flags.

## Specific L3 cliffs

A custom trusted Fastify route requires boot-time app/internal composition. A static `agentTools` contribution with host dependencies requires boot-time composition. A
provider tree requires programmatic/static composition. A binding tree requires programmatic/static composition. A backend/domain service injection requires trusted host
composition. A trusted SQL handle cannot be expressed as a scalar config value. An `actorResolver(request)` callback cannot be expressed as a flag. An
`actorVerifier(actor)` callback cannot be expressed as a flag. A browser-auth policy cannot be expressed as a safe generic string. Workspace bridge operation handlers are
executable behavior. A `frontTargetResolver` is executable behavior. A custom `harnessFactory` is executable behavior. Telemetry and metering sinks are executable
behavior. Request-aware filesystem bindings are executable behavior. A runtime provisioner is executable behavior. A custom runtime-mode adapter is executable behavior.
These appear in `CreateWorkspaceAgentServerOptions` and `CreateAgentAppOptions`. They force a direct move from the stock CLI surface to programmatic composition. No
honest number of flags prevents that. “L0 must never be a dead end” is therefore unachievable if “dead end” means every capability can be reached by one incremental
scalar override.

## Replacement recommendation

Use a branching capability map, not four universal layers. Branch A: stock local workspace. Branch B: runtime Pi tool/skill/front extension. Branch C: trusted server
extension for routes, host tools, providers, and bindings. Branch D: embedded host for auth, database, filesystem, telemetry, and runtime callbacks. Keep flags and config
for scalar policy inside a branch. Make the branch transition explicit when a requested capability crosses trust or lifecycle. Add `boring-ui explain <capability>` or a
decision table that points to the required branch. Say plainly that L2 can reference code, but code behavior is L3.

# Finding 7 — “Runtime plugin” is not a safety default

**Verdict: WRONG**

## Evidence

The proposal says “no trusted routes requested” selects the runtime/generated tier. That inference confuses route lifecycle with execution trust. `PLUGIN_SYSTEM.md:58-60`
says plugin tools execute in the host Node process and bypass the sandbox by design. A runtime plugin is trusted local workspace code. It is not an untrusted plugin
sandbox. Conversely, requesting a trusted route does not automatically authorize the code or tell the host which actor/database capabilities it may receive. Tier
selection depends on provenance, trust, lifecycle, deployment, and capability needs. Absence of one requested feature cannot infer all of those.

## Replacement recommendation

Default a scaffold to route-free runtime form only because it is the hot-reloadable local authoring form. Label that as lifecycle/provenance, not security isolation. When
routes/providers/bindings are requested, explain why app/internal composition is required and require an explicit trust decision. Do not print “runtime tier” as if it
certifies sandboxing.

# Finding 8 — Host-shape default: convenient only for one product surface

**Verdict: WEAK**

## Wrong-default case

Folder-mode CLI is wrong for a headless HTTP service. It is wrong for an embedded/branded host. It is wrong for a saved multi-workspace server. It is wrong for a deployed
core app. It is wrong when opening a browser is undesirable. The CLI already has a separate `workspaces` mode. The repository also exposes programmatic hosts. Calling
folder mode “the default host shape” is safe only for the literal `boring-ui [folder]` command, not for the product.

## Replacement recommendation

Keep folder mode as the default behavior of the folder command. Do not elevate it into a universal product default. Provide explicit `serve`, `workspaces`, and embed
documentation rather than silently guessing host intent.

# Finding 9 — Git-root workspace detection silently widens authority

**Verdict: WRONG**

## Wrong-default case

A developer launches from `monorepo/packages/payments` expecting that package only. Git-root detection changes the workspace to the whole monorepo. File tools can now
read sibling packages. Shell commands run with broader context. Plugin discovery changes. Instruction discovery changes. The session namespace changes. Potential secret
exposure scope changes. This is worse because the product made the authority expansion silently. The proposal contradicts current intentional code.
`packages/cli/src/server/cli.ts:169-171` resolves exactly the explicit folder or cwd. It does not search upward for a Git root.

## Replacement recommendation

Keep exact explicit positional path as authoritative. Keep exact cwd when no path is supplied. Offer `--git-root` as an opt-in convenience. If Git root is suggested
interactively, show the scope expansion before applying it.

# Finding 10 — bwrap-if-available reverses the current latency/network contract

**Verdict: WRONG**

## Wrong-default case

A developer expects instant local startup and tools with network access. Bubblewrap is installed on the machine. The proposal silently selects it. First boot now pays
pack/extract/provisioning cost. Network-dependent tools fail because local-sandbox mode has no network. Non-Linux platforms fall back to direct, so identical commands
have different trust behavior. Availability says nothing about developer intent. The code explicitly chose the opposite default. `packages/cli/src/server/cli.ts:310-325`
defaults to direct on every platform. Its comment explains why: direct boots nearly instantly; bwrap provisioning cost should be paid only when the caller explicitly
wants isolation. `packages/cli/src/server/modeApps.ts:27-28` documents direct as full network and local-sandbox as bwrap/no network. This is not an accidental missing
smart default. It is a deliberate tradeoff. Direct is also wrong for untrusted code. Therefore neither choice is universally safe.

## Replacement recommendation

Preserve direct for backward compatibility in the current folder command. Make its unsandboxed status unmistakable on first interactive use and in `doctor`. Offer an
explicit security profile such as `--mode local-sandbox`. Persist an informed per-user/per-project preference only after consent. Do not switch behavior based only on
executable availability.

# Finding 11 — Tool-surface default hides a real composition boundary

**Verdict: WEAK**

## Wrong-default case

A tool needs a host database handle, verified actor, billing sink, telemetry context, or request-aware filesystem binding. A Pi resource cannot safely express that as a
workspace-local hot-loaded module. The correct surface is a trusted boot-time `AgentTool` or server plugin. Conversely, a local tool/skill that should hot reload is worse
as static `extraTools`. The choice depends on capability and trust, not convenience alone.

## Replacement recommendation

Default simple local authored tools to Pi resources. State the limits in the scaffold output. Route host-service, actor-aware, or server-mediated tools to the trusted
branch. Do not promise that every row has an escape independent of the other architecture axes.

# Finding 12 — Shared Pi credentials are safe to read, unsafe to mutate silently

**Verdict: WEAK**

## Wrong-default case

The user has a subscription OAuth credential for a provider. An inline API key flow replaces it globally. Every Pi and Boring project now observes the changed credential.
In a container, `~` belongs to a service account and may be ephemeral. In a shared service account, it may affect multiple deployments. In deployment, the durable
credential path may be mounted elsewhere. Provider and model choice cannot be inferred from an arbitrary key.

## Replacement recommendation

Reading Pi's resolved auth sources is a sound interoperability default. Mutation must be explicit, provider-qualified, Pi-API-mediated, and described as user-global.
Environment/runtime injection should be the default automation path.

# Finding 13 — The session-root default is local compatibility, not universal policy

**Verdict: WEAK**

## Wrong-default case

`~/.pi/agent/sessions` is read-only in a sandbox or container. It is ephemeral in a stateless service. It is shared between users under one service account. It is not the
host application's durable volume. The project hard rules explicitly require deployed host history to live under `BORING_AGENT_SESSION_ROOT`, commonly
`/data/pi-sessions`, not sandbox home. Path-derived local namespaces can orphan discoverability when a workspace moves. The study itself hit ENOENT at this default and
had to set `BORING_AGENT_SESSION_ROOT`.

## Replacement recommendation

Keep Pi's local session root for the single-user local CLI only. Require an explicit/durable host session root in deployed or multi-user modes. Preflight writability
before admitting a session. Return `SESSION_STORE_UNWRITABLE` with path, errno, and remediation.

# Finding 14 — Only two proposed defaults are genuinely low-risk

**Verdict: SOUND**

The safe defaults are narrower than the table suggests. Loopback host is safe for the local CLI. Exact explicit positional workspace is safe because the caller named it.
Exact cwd is acceptable when the caller invoked folder mode without a path. Reading existing Pi credentials without mutation is safe interoperability. Everything else is
a policy guess: host shape depends on product mode; sandbox depends on security, network, platform, and latency; plugin tier depends on provenance and capability; tool
surface depends on host dependencies and trust; credential persistence affects global state; session root depends on deployment ownership and durability.

## Replacement recommendation

Classify defaults as command-local, environment-derived, persisted preference, or host-required policy. Do not present all defaults as equally safe smart inference.

# Finding 15 — “6 concepts versus 3” is not a fair comparison

**Verdict: WRONG**

## Evidence

The study counts our architecture choices before implementation: host shape; workspace root; runtime mode; plugin trust tier; Pi resource versus server tool; provider
auth-store setup. For Flue, it counts only supported Node, target, and provider/model/key. But the actual Flue task also required the developer to understand or act on:
the `local()` host sandbox; `defineTool` and `useTool`; `useSkill`; Hono; Vite; `@flue/vite`; the HTTP router/session contract. For eve, the “3” excludes:
filesystem-discovered tool shape; filesystem-discovered skill shape; sandbox/workspace policy; HTTP channel/auth policy; durable session semantics. The study counts our
broader integrated product architecture against the peers' narrow first action. That is apples against a subset. It also counts implementation concepts even when L0 users
do not choose them.

## Scope-matched recount

For “use built-in codebase Q&A locally over HTTP,” Boring requires two product decisions: target folder; provider authentication. Supported runtime/install is common to
all three and should be counted consistently. For “extend with one tool and one skill,” all three require roughly these axes: provider/model credentials; tool authoring
API; skill authoring contract; filesystem/sandbox policy; HTTP/session contract. Boring adds a plugin trust/lifecycle decision only when the requested extension crosses
from local Pi/front behavior into trusted backend behavior. Flue adds explicit local sandbox mounting and application HTTP composition. eve adds its file
compiler/channel/world conventions. The honest conclusion is parity in essential extension concepts, with different cliffs. It is not 6 versus 3.

## Replacement recommendation

Count user decisions at the moment the user must choose. Count the same task scope for every product. Separate L0 usage concepts from extension concepts and deployment
concepts. Report architecture vocabulary exposure separately from required decisions.

# Finding 16 — The ranking formula has invented numerators

**Verdict: WRONG**

## Evidence

The study measured one expert/agent-guided run. It did not measure multiple developers. It did not measure time spent reading each documentation fork. It did not measure
time lost to the panel-id defect. It did not measure repeat-run warning cost. It did not measure implementation effort. Yet the issue ranks by “developer-minutes saved /
effort” with ranges such as 15–30 minutes, 5–20 minutes, and 1–5 minutes every run. Those are priors presented as measurements. The study's whole Boring path reached
verified plugin/skill discovery in 41.5 seconds and in-process HTTP handlers in 1 minute 37.1 seconds. That does not prove a novice would be fast. It does prove the
claimed 15–30 minute quickstart saving was not observed in this run.

## Replacement recommendation

Rank confirmed defects by severity/confidence. Rank enhancements by expected impact, confidence, implementation range, and risk. Label all unmeasured time savings as
hypotheses. Validate them with onboarding sessions or task telemetry before using ratios.

# Finding 17 — Spot check: panel-id fix is cheap, but its savings are invented

**Verdict: SOUND**

## Evidence

`packages/plugin-cli/templates/front-canonical.tsx:24` registers `<id>.page`. `packages/plugin-cli/templates/agent-canonical.ts:12` opens `<id>.panel`. The defect is real
and first-interaction-visible. The current scaffold tests do not enforce the cross-template invariant. Changing one canonical value and adding a generated-output/golden
assertion is plausibly under one hour. The claimed 5–20 minutes saved was not measured. Some users never invoke the generated slash command. Others may spend much longer
diagnosing it.

## Replacement recommendation

Keep it first as a confirmed broken-default defect, not because of a fake ratio. Use one shared placeholder/fixture assertion so front registration and command target
cannot drift again.

# Finding 18 — Spot check: “verify executes registration” is over an order of magnitude low

**Verdict: WRONG**

## Evidence

The issue estimates 1–2 days and proposes reusing `packages/cli/src/server/pluginFrontRuntime.ts`. That runtime is 2,229 lines and depends on Vite/runtime-host machinery.
`packages/plugin-cli/src/server/verifyPlugin.ts` is a 471-line synchronous static verifier. Its contract explicitly says it does not execute plugin code.
`packages/plugin-cli/package.json` has no runtime dependencies. The CLI package depends on plugin-cli. Making plugin-cli import CLI runtime code reverses dependency
direction and risks a cycle. Executing registration means executing arbitrary workspace developer code. That code can mutate files, spawn processes, access the network,
hang, exit, or retain handles. Pi extensions and front modules need different compilation/runtime environments. A credible implementation needs an extracted compiler
service, isolated worker/process, timeouts, resource limits, deterministic host stubs, side-effect policy, diagnostics mapping, dependency resolution tests, and hostile
fixtures. That is plausibly 1–2 weeks, not 1–2 days. The estimate is over an order of magnitude low at its lower bound. It also changes the meaning of a safe static
`verify` command into an arbitrary-code runner.

## Replacement recommendation

Keep `verify` static and side-effect-free. Add a separate opt-in `plugin test --compile` for front transformation. Add `plugin test --load` only with explicit
arbitrary-code warning, isolation, and timeout. Extract shared compiler primitives downward into a dependency-neutral package. Do not claim registration executed unless
the test host faithfully represents the real host.

# Finding 19 — Spot check: warning-noise savings are inflated by 10–100×

**Verdict: WEAK**

## Evidence

Item 8/9 claims 1–5 minutes saved every run for three startup warnings. Reading those warnings takes seconds, not minutes. The study captured them in a special local
build/runtime path that ended in forbidden bind. It did not establish that every packaged run emits every warning. The Vite deprecation is an owned defect and should be
fixed. The invalid JSX option needs a source before estimating work. The bridge warning is a deliberate security diagnostic. Demoting it everywhere can make unsafe
exposure easier to miss. The numerator is therefore inflated roughly one to two orders of magnitude.

## Replacement recommendation

Measure packaged stderr on supported launch modes. Fix verified owned deprecations. Attach source/location to validation warnings. Suppress or informationally render the
bridge notice only for proven loopback local mode. Keep it loud for non-loopback or ambiguous exposure.

# Finding 20 — `doctor` combines checks with incompatible semantics

**Verdict: WEAK**

## Evidence

Provider/auth-source inspection can be read-only. Session-root writability can be tested against the actual target. Listener “availability” is TOCTOU unless the process
binds and holds the socket. A doctor that probes and releases a port cannot promise startup will bind it later. Deep provider credential resolution can execute
shell-backed configuration and block. The workspaces-mode startup intentionally avoids this scan for latency. Running all doctor checks at every startup regresses the
path it intends to improve.

## Replacement recommendation

Provide a standalone `boring-ui doctor` with cheap default checks and explicit `--deep`. At startup, check only invariants required for the selected launch path. Let the
actual listener bind be the listener check. Do not claim race-free availability before bind. Report auth source without resolving secret values unless deep validation is
requested.

# Finding 21 — The quickstart recommendation is good; its benchmark claim is not

**Verdict: SOUND**

## Evidence

The exact task currently crosses CLI, plugin, agent, Pi, and HTTP documentation. The CLI README does not publish the full create/prompt/state happy path. The study itself
used `sessionId` instead of the actual returned `id` once. That is credible evidence that the API continuation is insufficiently documented. One task-oriented quickstart
would reduce architecture exposure. But “saves 15–30 minutes” remains unmeasured.

## Replacement recommendation

Keep the quickstart. Show one copy/paste path, exact responses, and explicit branch points. Do not market the failure-heavy competitor timing as framework speed. Do not
attach an unsupported time-saving number.

# Finding 22 — Agent-only scaffold is useful but creates a second template contract

**Verdict: SOUND**

## Evidence

The current canonical scaffold emits an unnecessary 125-nonblank-line front panel and slash command for an agent-only tool/skill task. Removing it reduces inspection
surface and avoids the panel-id decision entirely. The code path in `scaffoldPlugin.ts` is small enough that a one-day first slice is plausible. However, `--agent-only
--skill` creates another generated shape that must remain aligned with manifests, verifier behavior, docs, and golden tests. The issue counts generation savings but not
maintenance cost.

## Replacement recommendation

Keep the feature after defining one composable template model rather than duplicating whole templates. Golden-test both shapes. Ensure the output says exactly which
capabilities are absent and how to add a front later.

# Finding 23 — Stable session-store error is a real product fix

**Verdict: SOUND**

## Evidence

The study received:

```json
{"error":{"code":"INTERNAL_ERROR","message":"ENOENT: ... ~/.pi/agent/sessions/..."}}
```

The failure has a known operator remedy: set `BORING_AGENT_SESSION_ROOT` to a writable durable directory. The current stable-code taxonomy does not capture it. The
adapter already knows the selected root and failing filesystem operation. Two to four hours for classification, mapping, docs, and focused tests is plausible.

## Replacement recommendation

Add `SESSION_STORE_UNWRITABLE` or a more general stable storage-initialization code. Include path, errno, deployment-specific ownership guidance, and retryability. Do not
expose raw secrets or unrelated path internals.

# Finding 24 — The design principle optimizes the demo over existing users

**Verdict: WRONG**

## Evidence

Automatic bwrap makes existing startup slower and removes network access. Git-root detection broadens existing workspace scope. An always-on banner increases log noise. A
mandatory credential prompt can hang CI and services. Persisting `--api-key` mutates global Pi state. Silently selecting plugin tier hides trust/lifecycle distinctions
the current docs make explicit. Demoting the bridge warning can hide unsafe exposure. Running deep doctor checks at startup can delay first assets. All of these make the
first demo smoother in one environment while changing established behavior for repeat users, automation, monorepos, containers, and deployed hosts. The issue contains no
compatibility section. It contains no migration plan. It contains no opt-in rollout. It contains no telemetry plan. It contains no rollback criteria.

## Replacement recommendation

Treat first-run UX and repeat-run/server UX as separate modes. Preserve current defaults unless evidence supports migration. Gate changed inference behind explicit
commands or persisted consent. Add compatibility tests for non-TTY, JSON, CI, monorepo subdirectory, no-network tools, read-only home, relocated Pi root, and multi-user
deployment.

# Finding 25 — Several headline claims are unfalsifiable as written

**Verdict: WRONG**

## Unfalsifiable claims

“Show the wow first.” No observable success criterion defines “wow.” “Never ask a question you can answer yourself.” No rule distinguishes factual detection from policy
or consent. “Five lines replace six decisions.” No decision-comprehension or override-discovery metric exists. “L0 must never be a dead end.” No definition of dead end
survives programmatic capability cliffs. “The one thing that destroys it.” No first-run funnel or abandonment evidence attributes failure primarily to auth handoff.
“Nothing else costs us more first impressions.” No comparative first-impression measurement exists. “The wow is already built.” The underlying study produced no model
reply for any product. It therefore did not observe the claimed wow. “We win on output and speed.” No system produced the target reply. Flue's elapsed time included more
than 200 seconds of npm silence and manual dependency recovery. eve was not run. Those data cannot establish a general speed win.

## Replacement recommendation

Replace slogans with measurable hypotheses: median time from install to first successful reply; percentage completing without leaving the terminal; percentage selecting
the intended workspace boundary; percentage understanding direct versus sandboxed execution; non-interactive startup success rate; structured-output byte purity;
repeat-run banner dismissal/recall; credential setup completion and recovery rate.

# Finding 26 — The study supports defects, not a universal default philosophy

**Verdict: WEAK**

## Evidence

The study is candid that no system produced a reply. Flue's comparison included network/cache failure and a copied dependency tree. eve's path was reconstructed from a
tarball under an unsupported Node runtime. Boring's path used an expert/agent following internal skills and in-process injection because listeners were forbidden. The
evidence is valuable for concrete defects: panel mismatch; late session-root error; missing HTTP response docs; warning noise; auth handoff friction. It is not strong
evidence for a universal four-layer architecture, automatic bwrap, Git-root inference, persistent inline credentials, or always-on banner policy.

## Replacement recommendation

Separate the issue into confirmed defects, documentation improvements, and product hypotheses. Ship confirmed defects first. Prototype hypotheses behind flags. Run actual
first-reply studies on supported machines before changing defaults.

# Final disposition — the nine changes I would keep

The public issue/body has version skew: the cached study lists ten ranked rows while the filed summary condenses them to nine. The disposition below uses the nine-change
filed summary described in the request:

1. panel-id invariant;

2. exact quickstart;

3. agent-only scaffold;

4. executable verify;

5. doctor/startup checks;

6. HTTP happy path;

7. stable session-store error;

8. startup warning cleanup;

9. plugin-shape collapse.

## Keep, in revised priority order

### 1. Canonical panel id plus invariant test

**Keep.**

It is a confirmed broken first interaction. Rank it by severity and certainty, not invented minutes saved.

### 2. Stable remedial session-store error

**Keep.**

It turns an observed opaque failure into an actionable contract. Include deployed-host durable-root guidance.

### 3. Publish HTTP happy path and response schemas

**Keep.**

The study's `id` versus `sessionId` mistake is direct evidence. Document exact 201, 202, state, and error bodies.

### 4. One task-oriented codebase-agent quickstart

**Keep.**

Do not claim 15–30 minutes saved without measurement. Put advanced trust/deployment forks after the success path.

### 5. Agent-only scaffold

**Keep.**

Implement it as a composable scaffold profile with golden tests. Do not duplicate an entire template family casually.

### 6. Standalone `boring-ui doctor`

**Keep, narrowed.**

Cheap read-only checks by default; explicit `--deep` for credential resolution. Do not promise listener availability before the actual bind. Do not run deep checks on
every startup.

### 7. Remove verified owned startup warning noise

**Keep, narrowed.**

Fix the Vite deprecation and identify the JSX option source. Preserve the bridge warning for unsafe/ambiguous exposure. Do not rank it using “minutes every run.”

## Drop entirely as written

### 8. Make `verify` import/execute registration and compile front code

**Drop.**

It destroys the static verifier's safety contract, reverses dependency direction, executes arbitrary code, and is underestimated by more than an order of magnitude.
Replace it with separate opt-in isolated `plugin test --compile` and `--load` commands.

### 9. Collapse and silently infer plugin shape

**Drop.**

Plugin shape is a real capability/trust/lifecycle branch. Runtime tools bypass the sandbox, while routes/providers/bindings require boot composition. Replace silent
inference with a default route-free scaffold plus explicit capability escalation.

## Separate design-principle changes to reject

Reject the always-on five-line banner. Reject raw writes to `~/.pi/agent/auth.json`. Reject persistent literal `--api-key VALUE`. Reject automatic Git-root expansion.
Reject bwrap-if-installed. Reject the claim that L0 can never reach an honest programmatic cliff. Keep the underlying goals: fast interactive success; same-terminal
credential setup; visible provenance on demand; progressive scalar configuration; and explicit, documented capability branches.
