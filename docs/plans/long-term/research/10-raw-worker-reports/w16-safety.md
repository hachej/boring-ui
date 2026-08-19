# Control matrix

| control | opencode v2 | eve 0.31.3 | Flue 2.0.3 | boring-ui `origin/main` | who is strongest |
|---|---|---|---|---|---|
| Default tool posture | Ordered allow/deny/ask rules; no match asks, but shipped defaults broadly allow ordinary tools | Authored tool approval defaults to `never()`, meaning execute without a prompt | No native approval layer; mounted tools execute | MCP connector/tool admission is exact-match, per-agent, default-deny; other tools are not covered by that grant system | boring-ui for MCP only; none universally |
| Policy vocabulary | action + resource + effect | `never()`, `once()`, `always()`, or custom callback | application-defined conditional tool mounting | exact MCP grants; governance grants; proposed exec grants | opencode |
| Tool-level deny | Yes | Yes, if custom policy returns denied | Only by omitting/wrapping tool | Yes for MCP admission; proposed for bash | opencode |
| Tool-level ask | Yes | Yes | Application must build it | ask-user can collect answers but is not an execution interceptor | eve |
| Resource-aware decision | Path, shell string, URL, query, agent, skill, MCP tool | Custom callback receives validated tool input | Application code may inspect input | MCP matches connector/tool identity; no general resource approval | opencode |
| Rule order | Last matching rule wins | Callback result per call | Application-defined | Exact-match sets avoid precedence | boring-ui for ambiguity avoidance |
| Pattern language | `*` and `?`; whole-value matching | Application-defined | Application-defined | Glob metacharacters rejected in MCP allowlists | boring-ui for MCP safety; opencode for expressiveness |
| Multi-resource call | deny dominates, then ask, then allow | Custom policy must implement | Application-defined | Not a generic abstraction | opencode |
| Unknown action/resource | Ask | No approval unless tool declares one | Executes if mounted | Unknown MCP connector/tool is dropped | boring-ui for MCP; opencode generally |
| Approval once | Yes | Yes, remembered by bare tool name in current session | No primitive | No execution-approval primitive | eve/opencode |
| Approval always | Yes | `always()` means ask every time, not persist allow | No primitive | No primitive | opencode |
| Always-allow scope | Public v2 contract says current project | N/A | N/A | N/A | opencode |
| Always-allow persistence | Public v2 contract describes saved approvals; visible main implementation only keeps an in-memory array | Session state for `once()` | N/A | N/A | opencode contract, with source-version caveat |
| Revocation | Remove saved approval through permission UI/config; configured deny still dominates | End session or alter app policy/session state | Remove tool/policy in app | Revoke stored MCP/governance grant | boring-ui for explicit grant lifecycle; opencode UI ergonomics |
| Reject semantics | Reject current request and visible source rejects all same-session pending requests | Denied call does not execute | Application-defined | ask-user answers a question; no standardized execution rejection | opencode |
| Noninteractive behavior | Auto mode can answer once; otherwise request rejects; explicit deny remains enforced | Session parks durably until input or application resolves it | No approval wait primitive | ask-user has a pending waiter/store but no tool-call continuation protocol | eve |
| Check placement | Tool calls `ctx.ask`; edit computes diff before ask and writes after | Framework approval hook around validated tool | Wrapper/conditional tool code | MCP grants shape exposed connector/tool surface before invocation | boring-ui for structural admission; eve for approval lifecycle |
| Shell granularity | Raw full command string | Tool-input-aware custom policy | Application-defined wrapper | Proposed exec grant is tool-level, not parsed command policy | opencode, with parser weakness |
| Shell parsing | Raw string glob, not an AST | None built in | None built in | None shipped | none |
| File read | `read` path permission plus external-directory boundary | Sandbox/tool policy; no special read approval default | Sandbox API/tool executes | boring-bash path API confined; direct shell can bypass | opencode for prompt; boring-ui runsc for enforcement |
| File write | `edit` permission plus external-directory boundary | Sandbox/tool policy; silent default | Sandbox API/tool executes silently | boring-bash confined; shell/provider dependent | opencode for prompt; boring-ui runsc for confinement |
| File deletion | Shell `rm` is only as safe as shell rule; edit-class tool deletion follows edit | `rm` through bash; silent unless policy added | `rm` API/bash; silent | workspace unlink is confined but silent; shell arbitrary when admitted | boring-ui for confined primitive; none for intent |
| Force push | Ordinary shell command; silent under broad shell allow | Silent if bash/network/git available | Silent if bash/network/git available | Silent if bash admitted and network available | none |
| Package install | Ordinary shell command | Silent if sandbox permits shell/network | Silent if backend permits shell/network | Silent if bash admitted; runsc network blocks download | boring-ui runsc for network barrier |
| Arbitrary shell | Host shell is a first-class tool | Built-in bash in sandbox | Sandbox bash; local adapter is host shell | direct, bwrap, and runsc exec accept shell commands | none at intent layer |
| Network fetch tool | URL resource can be allowed/asked/denied | `web_fetch` may be wrapped with approval | Custom/MCP | MCP exact admission only; no URL policy | opencode |
| Shell network egress | Host network; no sandbox boundary | Backend-dependent; not universally deny-all | virtual sandbox allowlist/deny-by-default; local has host network | runsc `--network none`; bwrap defaults shared; direct host | Flue virtual / boring-ui runsc |
| Workspace isolation | Permission boundary, not OS sandbox | Sandbox backend boundary | Sandbox backend boundary | bwrap/runsc OS isolation; direct none | boring-ui runsc |
| Absolute path | External path may ask and then be allowed | Public API does not specify portable rejection | Accepted by sandbox API; local uses it | boring-bash rejects; runsc helper rejects; direct accepts cwd | boring-ui confined APIs |
| `..` traversal | Canonical external boundary is documented; shell arguments are not comprehensively parsed | Provider-dependent | Lexically normalized, not a containment promise | boring-bash rejects aggressively; runsc helper rejects components | boring-ui |
| Encoded traversal | No explicit contract found | No explicit contract found | No explicit contract found | boring-bash decodes once and rejects; test corpus covers `%2F` | boring-ui |
| Windows absolute path | Normalization and case-insensitive matching documented | Provider-dependent | Provider-dependent | boring-bash rejects drive and UNC forms | boring-ui |
| Symlink read escape | Docs say symlink escapes are rejected; visible external check does not itself call `realpath` | Provider-dependent | No framework-level guarantee | boring-bash realpaths existing target; runsc forbids symlink traversal | boring-ui runsc |
| Symlink write escape | Documented rejection; source path needs version confirmation | Provider-dependent | No framework-level guarantee | target symlink rejected; parent realpathed; runsc uses dirfd/openat2 | boring-ui runsc |
| TOCTOU resistance | No dirfd/openat2 evidence found | No portable guarantee | No portable guarantee | runsc helper uses anchored FDs/openat2; node path APIs remain check-then-use | boring-ui runsc |
| Temp directory | Special external-boundary exception; host temp remains reachable to shell | Backend temp semantics | virtual ephemeral; local uses host TMPDIR | bwrap fresh tmpfs `/tmp`; runsc bounded tmpfs; direct host temp | boring-ui isolated providers |
| Additional mounts | External-directory approval | Provider/application-defined | Adapter-defined | Issue 1123 designs canonical mount sets and lease keying; not shipped | none shipped generally |
| Mount identity | Not a lease concept | Provider-specific | Provider-specific | Proposed mount set in lease key prevents cross-grant reuse | boring-ui design only |
| Unsupported mount request | N/A | Provider-specific | Provider-specific | Issue 1123 says reject non-empty mounts on incapable provider | boring-ui design only |
| Host credential ambient access | Host shell may inherit available environment/config | Sandboxes are intended not to inherit app environment | local passes a short env allowlist; secrets explicit | direct and bwrap default to a host env snapshot; runsc uses brokered refs | Flue local default / boring-ui runsc |
| Credential routing hidden from model | Connector auth handled outside normal tool args in relevant integrations | Auth callbacks and provided args | MCP auth callback/string outside model args | runsc credential refs are value-free and scope-checked | boring-ui runsc |
| Secret material lifetime | No general broker | Connection auth resolved at execution | Adapter/MCP request lifetime | leases disposed, buffers zeroed, secret execution made non-replayable, container replaced | boring-ui runsc |
| Secret in tool output | No automatic scrub found | No automatic scrub found | No automatic scrub found | No automatic stdout/stderr scrub found | none |
| Secret in logs | No general redaction guarantee found | OAuth challenge is model-redacted; general tool output/log scrub not guaranteed | Traces include content by default unless configured/transform-redacted | Output can reach callbacks/results; no universal value redaction | none; Flue is clearest about opt-out |
| Secret in telemetry | No universal policy found | No universal policy found | Content captured by default; `content:false`/transform available | No universal governance telemetry redactor found | none |
| Output bounds | Tool output truncation exists | Backend/tool dependent | Runtime/tool dependent | direct/bwrap cap output; runsc enforces bounded envelopes/output | boring-ui |
| File prompt injection | Workspace instructions are intentionally loaded; file text enters context | File output enters context | workspace instructions and tool output enter context | No trust label or isolation found | none |
| Web prompt injection | Web output is ordinary tool content | Web output is ordinary tool content | Custom/MCP output ordinary content | MCP output ordinary content | none |
| MCP prompt injection | Text returned directly as tool result | Connection/MCP result enters model | MCP result flattened to text | Allowed MCP result enters model | none |
| Untrusted-content taint | None found | None found | None found | None found | none |
| Instruction/data separation | No structural boundary | Guidance can tell model to treat facts as data | No structural boundary | Governance context is still prompt content | none |
| Parser/code injection | Not assessed beyond tool schemas | Remote OpenAPI frontmatter code evaluation was disabled | Schemas and runtime parsing | Strict envelopes and schema validation in runsc | eve for its repaired OpenAPI seam; boring-ui runsc generally |
| Policy evaluation error | Tool call fails/asks; no allow fallback found | Callback throw aborts execution | Application-defined wrapper error | Grant resolver malformed record becomes empty list; unknown connector drops | boring-ui MCP |
| Sandbox unavailable | No sandbox dependency | Agent/sandbox setup fails | Sandbox creation fails | bwrap preflight throws; no silent direct fallback in that provider | tie |
| Credential resolver error | Integration-specific | Auth callback failure blocks request | MCP auth failure blocks request unless optional server policy applies | runsc rejects ref/delivery and cleans/retires on uncertainty | boring-ui runsc |
| Unknown execution outcome | Host process semantics | Backend-specific | Ordinary durable tool is not replayed; reports unknown; opt-in durable step may retry | runsc replaces/retires container when cleanup cannot be proven | boring-ui runsc |
| Abort after side effect starts | Host command termination not transactional | Backend-specific | Remote command may continue after local abort | process group kill; runsc treats unproven cleanup as terminal/replaces | boring-ui runsc |
| Optional dependency failure | MCP/tool-specific | Connection-specific | Optional MCP may mount zero tools; required MCP fails submission | Unknown connector is dropped with diagnostic | boring-ui for deny; Flue for explicit degraded mode |
| Auditability of decisions | Permission asked/replied events | Input/session lifecycle events | Rich runtime/tracing events | Stable MCP diagnostics; ask-user transcript; fragmented across subsystems | eve/opencode |
| Universal authorization seam | Permission service is closest, though tool authors must call it correctly | Framework approval hook applies only declared policy | None | None; MCP grants and sandbox execution are separate | opencode |
| Strongest overall property | Usable resource-pattern approval UX | Durable, programmable HITL lifecycle | Safe virtual sandbox defaults and explicit observability controls | Exact MCP admission and runsc confinement/credential cleanup | split by layer |

## Bottom line

No implementation wins the full stack. 
OpenCode has the most complete user-facing permission language. 
Eve has the most complete approval continuation protocol. 
Flue's virtual sandbox has the cleanest lightweight network default. 
boring-ui has the strongest low-level path enforcement in the runsc workspace helper. 
boring-ui also has the strongest secret-bearing execution cleanup among the inspected implementations. 
Those boring-ui wins are provider-specific. 
They do not make `direct` safe. 
They do not turn `ask-user` into authorization. 
They do not solve output exfiltration or prompt injection. 
The most expensive false claim would be “governance covers it.” 
Governance currently controls grants, budgets, and selected context projection. 
It is not a universal reference monitor for filesystem, process, network, secret, or context trust.

## Evidence and version boundaries

OpenCode evidence was checked against its official v2 permission documentation and the public `dev` source tree. 
The visible permission implementation imports `PermissionV1` and `ConfigPermissionV1`. 
Therefore the source establishes real mechanics but cannot silently be treated as proof of every v2 persistence claim. 
Where v2 docs and visible source differ, this report labels the distinction. 
The visible source state contains `pending: Map` and `approved: []`. 
The visible source appends allow rules on an `always` reply. 
That proves instance-memory behavior for the visible implementation. 
It does not prove durable project storage for v2. 
Eve source was checked at repository version `0.31.3` and against the named docs. 
Flue evidence came from the pinned offline CLI documentation at `@flue/cli@2.0.3`. 
boring-ui evidence came only from `origin/main` at commit `d44a689bb47638227cf7f930041ee593026f08bf`. 
Issue 1123 is explicitly `needs-owner-approval`. 
Its mount and exec design is not counted as shipped protection. 
The requested Jina curl endpoint was attempted but unavailable from the execution environment due DNS failure. 
Official pages and raw public source were then read through the available web reader.

## OpenCode v2: permission model in full

### Rule representation 
A rule has an action, a resource pattern, and an effect. 
Effects are allow, deny, and ask. 
Rules are ordered. 
The last matching rule wins. 
Global configuration is evaluated before agent-specific configuration. 
This permits a narrow later exception to a broad earlier rule. 
It also makes review harder than an exact allowlist because ordering is security-significant. 
The visible evaluator's decisive expression is `findLast(...)`. 
Its fallback is an ask rule. 
Short source quote: `action: "ask"`. 
Patterns use `*` and `?`. 
Matching applies to the whole resource value. 
Windows matching normalizes slashes and is case-insensitive. 
The documentation includes a convenience behavior for patterns ending in space-star. 
Multiple resources in one request aggregate conservatively. 
Any deny denies the call. 
Otherwise any ask prompts. 
Only an all-allow set proceeds silently.

### Gated actions and resources

`read` gates a workspace-relative or canonical external path. 
`edit` covers file mutation tools including write and patch. 
`glob` gates the glob pattern, not every returned path independently. 
`grep` gates the regular expression, not the searched path. 
This is a meaningful granularity hole. 
Allowing a regex does not authorize each file whose content it may expose. 
`shell` gates the raw complete command string. 
It is not a parsed command graph. 
Quoted strings, shell expansion, aliases, scripts, and nested shells defeat semantic intent matching. 
`webfetch` gates the URL. 
`websearch` gates the query. 
`subagent` gates the agent identity. 
`skill` gates the skill identity. 
`question` uses `*`. 
`external_directory` gates a canonical boundary outside the project. 
MCP permission identity is the joined server/tool name. 
The resource for an MCP invocation is `*`, so arguments are not separately authorized. 
`execute` exists as a broad execution action.

### Check placement

Tools call the permission context before their side effect. 
The edit tool resolves input and computes the diff before asking. 
It writes only after the approval resolves. 
The read tool performs external-boundary checking and then asks for read permission. 
The external-directory helper asks with the parent-directory glob. 
Short source quote: `permission: "external_directory"`. 
Tool plugin before-hooks run before the permission-mediated execution path. 
That means plugin hook code itself belongs in the trusted computing base. 
The architecture is not capability-safe if a plugin performs a side effect in a pre-hook. 
Permission coverage also depends on every side-effecting tool actually invoking `ctx.ask`. 
There is no single syscall-level reference monitor.

### Always allow

The approval UI supports once, always, and reject. 
The proposed always patterns are supplied by the tool request. 
The visible source pushes those patterns into an approved-rule array. 
It then scans pending requests in the same session. 
Pending requests whose patterns are all newly allowed are released. 
An always decision therefore has fan-out across already-pending calls. 
That fan-out is convenient but should be visible in audit UI. 
The visible source keeps the array in instance state. 
The v2 documentation describes saved project-scoped approvals. 
This is a source-contract mismatch, not evidence that one side is necessarily wrong. 
A configured deny cannot be overridden by an extra always approval. 
Revocation is documented as removing the saved approval through permission configuration/UI. 
The visible in-memory implementation is revoked by instance teardown. 
Rejecting one request rejects the other pending requests in that session in visible source.

### Defaults

The absence of a matching rule asks. 
But the shipped baseline rules broadly allow normal tool use. 
External-directory access asks. 
Reads of `.env`-style files ask by default. 
Example env files may be allowed. 
Temporary and managed output directories receive boundary exceptions. 
Build mode is broadly permissive. 
Plan mode blocks editing except its plan file. 
Explore mode is read-oriented. 
Mode defaults are UX policy, not process isolation.

### Destructive actions

There is no semantic “destructive” classifier. 
`rm -rf` is merely a shell string. 
`git push --force` is merely a shell string. 
`npm install` is merely a shell string. 
`curl | sh` is merely a shell string. 
If broad shell is allowed, all can run silently. 
If a pattern asks, matching can be bypass-prone because it is raw command text. 
An edit-tool deletion is governed by edit permission. 
That does not distinguish deleting one generated file from deleting a repository tree. 
Network egress through the shell is host network egress. 
The URL-aware web tool policy does not constrain shell network clients.

### Path confinement

OpenCode's boundary is permission-based, not a sandbox. 
The docs say relative mutations cannot escape the project. 
They also say symlink escapes from inside are rejected. 
Explicit outside paths are canonicalized and can trigger external-directory approval. 
The visible external helper normalizes on Windows and calls `containsPath`. 
That helper does not itself show a `realpath` call. 
The canonical/symlink guarantee therefore requires code outside that helper or newer v2 code. 
Shell enforcement is narrower. 
The shell working directory is checked against the external-directory boundary. 
The system does not reliably parse every path embedded in every command argument. 
An allowed host shell can read absolute paths, follow symlinks, use `/tmp`, or invoke another interpreter. 
The permission prompt can make that visible only when the command pattern catches it.

### Secrets

The `.env` default ask is useful accidental-disclosure friction. 
It is not secret brokerage. 
No general model-hidden credential reference protocol was found. 
No general secret-value redaction pass over tool output was found. 
No general telemetry redaction guarantee was found. 
If a permitted command prints a credential, the output can return to the model. 
If an MCP server returns a credential in text, it is ordinary MCP output.

### Prompt injection

File content enters ordinary tool-result context. 
MCP text enters ordinary tool-result context. 
Web content enters ordinary tool-result context. 
Repository instruction files are intentionally promoted into model instructions. 
That behavior is useful for trusted repositories. 
It is dangerous for untrusted checkouts. 
No provenance label, taint propagation, or instruction/data firewall was found.

### Failure behavior

No matching permission fails toward ask, not allow. 
An explicit deny blocks. 
Permission evaluation exceptions abort the tool path rather than granting. 
Missing pending approval IDs return not-found. 
Instance finalization rejects pending approvals. 
The dangerous “failure open” is policy breadth, not an observed catch-and-allow error handler.

## Eve 0.31.3

### Approval policy 
Approval is attached to authored tools or connections. 
`never()` returns not-applicable. 
`always()` returns user-approval. 
`once()` checks the current session's approved tool-name set. 
Short source quote: `approvedTools.has(toolName)`. 
The once key is the bare tool name. 
It ignores compound approval keys. 
That is too coarse for “same tool, different account/resource/action.” 
A custom callback receives session context, caller/turn context, tool name, validated input, approved tools, and call ID. 
It can return not-applicable, user-approval, approved, or denied, with reasons where applicable. 
Async callbacks permit application-owned policy lookup. 
An omitted approval policy is permissive. 
That is the largest safety default weakness in Eve.

### Destructive actions

Eve does not classify deletion, force push, installs, or arbitrary shell semantically. 
The built-in bash tool can express all of them. 
They are silent unless the application overrides or wraps the tool with approval. 
The same applies to file write. 
No special confirmation for recursive deletion was found. 
No special confirmation for force push was found. 
No package-manager policy was found. 
Network depends on the selected sandbox and connection tooling. 
The docs warn that sandbox egress is not universally deny-all.

### Path confinement

Eve delegates isolation to its sandbox backend. 
The intended workspace is `/workspace`. 
Hosted and microVM/container backends can keep host files outside the guest namespace. 
The public abstraction does not promise a single cross-provider path algorithm. 
No portable guarantee was found for rejecting absolute paths. 
No portable guarantee was found for rejecting `..`. 
No portable guarantee was found for rejecting symlink escapes. 
No portable guarantee was found for race-free resolution. 
Therefore backend choice is part of the security model. 
A confinement claim must name the actual backend and version.

### Secrets

The sandbox is designed not to inherit application `process.env` wholesale. 
Connection auth callbacks resolve credentials outside model-selected input. 
OAuth continuation data is transformed before model exposure. 
The model sees opaque connection identity rather than raw OAuth challenge material. 
This is a real structural advantage. 
The framework does not prescribe a universal vault. 
Application auth callbacks can still log secrets accidentally. 
Remote tool responses can still contain secrets. 
No automatic value-based scrub of tool output was found. 
No universal telemetry redaction guarantee was found.

### Prompt injection

File, web, and MCP/connection results enter model context as tool content. 
Memory guidance says to encode untrusted facts and treat them as data. 
That is prompting guidance, not an enforced trust boundary. 
No taint label or restricted-instruction channel was found. 
Eve did harden remote OpenAPI parsing by disabling code-capable frontmatter behavior. 
That prevents parser-side code execution from a remote specification. 
It does not prevent natural-language prompt injection inside a valid result.

### Failure behavior

An approval callback throw prevents executor invocation. 
A policy store failure should throw or deny. 
Credential callback failure blocks the outbound request. 
Sandbox initialization failure blocks sandboxed execution. 
The permissive default is absence of policy, not error recovery. 
The durable approval lifecycle is its major strength. 
It makes waiting explicit and recoverable across process boundaries.

## Flue 2.0.3

### Permission and approval surface 
Flue does not ship a native permission or approval policy engine. 
Tools are TypeScript functions exposed to the model. 
An application can conditionally mount tools based on state. 
That can implement a structural gate. 
The application owns request records, approval UI, scope, persistence, and revocation. 
Schema validation protects tool input shape. 
It does not authorize the requested resource. 
Thrown tool errors are returned as tool errors.

### Destructive actions

Sandbox bash is arbitrary shell. 
File write overwrites without a built-in confirmation. 
The sandbox API exposes removal. 
`rm` through bash is likewise silent. 
Force push is possible when git credentials and network exist. 
Package installation is possible when backend filesystem/network permit it. 
There is no destructive-command classifier. 
There is no automatic “confirm recursive delete” step.

### Sandbox variants

The virtual `just-bash` sandbox is in-memory and host-isolated. 
Its network is opt-in. 
Allowed URL prefixes provide a useful narrow egress control. 
Full internet requires an explicitly dangerous option. 
This is Flue's strongest safety default. 
The local adapter runs against the host filesystem and process environment. 
It is not an isolation boundary. 
Remote adapters inherit provider behavior. 
The word “sandbox” is therefore not a uniform guarantee.

### Path confinement

The sandbox API accepts relative and absolute paths. 
Relative paths resolve against `cwd`. 
`useSandbox({cwd})` changes the base directory. 
It does not create a containment boundary. 
Lexical normalization handles ordinary path syntax. 
No framework-wide ban on `..` was found. 
No framework-wide ban on absolute paths was found. 
No framework-wide symlink escape rule was found. 
No framework-wide openat-style race protection was found. 
The virtual backend remains host-safe because its filesystem is virtual. 
The local backend remains host-dangerous because absolute paths name host paths. 
Temporary-directory behavior is backend-dependent. 
The virtual backend is ephemeral. 
Local mode exposes the host temp directory named by its environment allowlist.

### Secrets

The local adapter passes a short host environment allowlist. 
This is better than wholesale ambient inheritance. 
Additional secrets must be supplied explicitly. 
MCP authorization may be a callback evaluated outside model arguments. 
That keeps bearer selection out of the model's schema. 
Once injected into a process environment, a model-driven shell can print it. 
MCP output is flattened to model-facing text. 
No automatic secret scrub was found on that text. 
Observability is deliberately rich. 
Runtime events can contain prompts, reasoning, tool inputs, outputs, and errors. 
Trace content is enabled by default in the documented Cloudflare path. 
`content:false` can disable it. 
A transform hook can redact it. 
Safe telemetry therefore requires operator configuration.

### Prompt injection

Tool output is model context. 
MCP output is model context. 
Workspace instruction files are loaded as instructions. 
No source trust class is attached. 
No taint propagation is attached. 
No policy prevents untrusted retrieved text from issuing instructions to the model.

### Failure behavior

Sandbox creation failure blocks initialization. 
Required MCP setup failure blocks submission. 
Optional MCP setup may degrade to zero mounted tools with warning and later retry. 
Unsupported removal options must fail before mutation. 
Ordinary durable tool execution is not blindly replayed after an in-flight crash. 
It reports unknown outcome. 
Explicit durable-step mode can replay and is at-least-once. 
The application must make side effects idempotent. 
A remote process can continue after the caller aborts if termination is not proven. 
The eventual output may be discarded while the side effect persists. 
That is a genuine failure-open edge for mutation.

## boring-ui `origin/main`

### MCP grants 
MCP admission is default-deny. 
The lookup key is the exact workspace ID and agent type ID. 
An undeclared or ungranted connector is dropped. 
The drop emits a stable diagnostic. 
Allowed tools are exact names. 
`*`, `?`, `[`, and `]` are rejected at grant write time. 
Short local source quote: `exact-match allowlist of tool names`. 
When a catalog is present, granted names are intersected with the connector's real tool set. 
An unknown connector is dropped. 
A malformed missing/non-array tool list becomes empty rather than throwing or allowing. 
This is excellent fail-closed admission behavior. 
It is narrower than OpenCode's general permission system. 
It does not inspect MCP arguments. 
It does not authorize a tenant/resource inside a granted tool call. 
It does not sanitize the tool result.

### Approval surface

`ask-user` is a question/answer transport. 
It is not wired as a universal before-execute interceptor. 
It has pending request identities and answer tokens. 
It stores question/answer transcript state. 
It avoids a lost wakeup by registering pending state before persistence. 
It can mark orphaned requests abandoned. 
It has no policy vocabulary for once/always/deny. 
It has no resource pattern language. 
It has no standard revocation story. 
Calling it “approvals” would overstate what is shipped.

### boring-bash file paths

The workspace path API rejects null bytes. 
It decodes URL encoding once for traversal checks. 
It normalizes backslashes for checks. 
It rejects POSIX absolute paths. 
It rejects Windows drive paths. 
It rejects UNC paths. 
It rejects traversal-like segments beginning with `..`. 
It rejects tilde and dollar-prefixed inputs. 
It rejects CR/LF. 
Existing reads realpath both root and target. 
Writable targets realpath the parent. 
An existing target symlink is rejected. 
This is strong for the API surface. 
The node implementation is still check-then-use. 
A malicious concurrent local actor could swap a checked ancestor before use. 
It also intentionally rejects some harmless names beginning with `..`. 
That conservative false positive is preferable to an escape here.

### runsc workspace paths

The runsc helper opens `/workspace` with `O_NOFOLLOW`. 
Every path is split into components. 
Empty, dot, dot-dot, absolute, null-containing, and oversized paths are rejected. 
Traversal uses directory file descriptors. 
Every open uses `O_NOFOLLOW`. 
Resolution uses `RESOLVE_BENEATH`. 
Resolution uses `RESOLVE_NO_MAGICLINKS`. 
Resolution uses `RESOLVE_NO_SYMLINKS`. 
Reads, writes, mkdir, unlink, rename, stat, and readdir use this anchored machinery. 
This is the strongest path implementation in the comparison. 
It prevents classic symlink swap and magic-link escapes at the kernel resolution boundary. 
It fails closed when `openat2` support/probe is unavailable.

### runsc execution isolation

The image must be digest-pinned. 
The container runtime is runsc/gVisor. 
The root filesystem is read-only. 
Capabilities are dropped and only SETUID, SETGID, and KILL are added. 
No-new-privileges is enabled. 
CPU, memory, PID, file, and output bounds are applied. 
Network is `none`. 
`/tmp` is a bounded tmpfs with nosuid and nodev. 
The workspace is the only application bind. 
The host mount source validator is lexical, not canonical. 
It derives the workspace path from a trusted root and UUID. 
A symlink at the host mount source remains a provisioning concern.

### bwrap execution isolation

bwrap unshares namespaces and creates a tmpfs root. 
It binds system directories read-only. 
It binds the workspace writable at `/workspace`. 
It creates a fresh tmpfs `/tmp`. 
It dies with its parent and normally starts a new session. 
Network defaults to shared. 
Capability dropping is optional, not default. 
Unless the caller supplies an explicit environment, bwrap spreads the host environment snapshot into the guest process. 
It rewrites `HOME`, Python paths, and workspace identity, but it does not reduce the remaining variables to a safe allowlist. 
Ambient API keys in the server process can therefore reach a model-driven bwrap shell. 
The workspace-root validator is lexical. 
It does not canonicalize the root. 
The cwd containment check is lexical. 
Readonly overlay mount paths are lexical and use `--ro-bind-try`. 
Global `.boring-agent` mounts are selected with stat/existence checks but not canonicalized. 
Trusted options can append raw bwrap arguments. 
This is acceptable as an internal trusted seam, not as untrusted configuration. 
The provider fails initialization if bwrap is missing. 
It does not silently fall back to direct execution.

### direct execution

The direct provider calls host `spawn` with `shell: true`. 
It accepts an arbitrary cwd. 
It performs no workspace containment check for that cwd. 
It preserves host home behavior. 
Unless explicitly overridden, it also passes the host environment snapshot. 
It has host filesystem and host network reach. 
It bounds captured output and terminates process groups on timeout/abort where possible. 
Those are availability controls, not confinement. 
Direct must be treated as trusted-development mode. 
It must not be selectable for untrusted agent work.

### Mount plan versus shipped state

Issue 1123 proposes a primary root plus mount set, exec capability, and lease lifecycle. 
The mount set would be part of lease identity. 
That prevents reusing a lease created with broader mounts for a narrower agent. 
Source roots would be realpathed once before bind. 
Resolved paths would be checked for containment. 
Providers without mount support would reject non-empty requests. 
Mounts would live under dedicated `/mnt/<filesystem-id>` paths. 
Shadowing under `/workspace` would be disallowed. 
Read-only FUSE mutations would return EROFS. 
Backend read errors would return EIO. 
The plan explicitly excludes network egress and secret-use grants. 
It gates the bash tool, not every provisioning or internal exec path. 
None of these plan-only controls may be credited as shipped.

### Secrets

runsc invocation references carry provider, execution, and binding identity without secret values. 
Resolution verifies workspace, sandbox, invocation, provider, binding, consumer, delivery channel, and expiry. 
Credential payloads are bounded. 
Leases are disposed on success and error. 
Buffers are zeroed. 
Secret-bearing invocations are non-replayable. 
The container is replaced around secret-bearing execution. 
Unknown cleanup causes replacement or retirement. 
These are unusually strong lifecycle controls. 
The credential is ultimately delivered to a model-directed process. 
That process can print it. 
Stdout and stderr are returned without value-based redaction. 
Output callbacks can observe those bytes. 
No universal telemetry scrub was found. 
MCP grants explicitly leave credential resolution out of scope. 
Therefore the runsc secret design is not yet a universal platform secret design.
The direct and bwrap defaults are materially weaker: both can inherit ambient server-process secrets before the credential broker participates.

### Prompt injection

Governance-provided company context is prompt content. 
MCP results are prompt content. 
Workspace files are prompt content. 
No trust provenance is propagated with those values. 
No instruction/data type system was found. 
No retrieval sanitizer can reliably solve this semantically. 
No policy limits what a compromised model may do based on source trust. 
MCP exact admission reduces the number of possible sources. 
It does not make an allowed source trustworthy. 
Sandboxing limits consequences but does not stop data exfiltration through an allowed channel.

### Failure-closed inventory

Malformed MCP grants reduce to empty tool lists. 
Unknown connectors are dropped. 
Unknown catalog tools are dropped. 
Glob metacharacters are rejected. 
bwrap absence aborts provider initialization. 
runsc schema failure rejects the request. 
runsc credential mismatch rejects the request. 
runsc secret execution cannot be replayed. 
runsc unproven cleanup replaces or retires the container. 
runsc unavailable path-safe primitives reject operations. 
Node path errors reject file operations.

### Failure-open or permissive inventory

Direct execution is intentionally unsandboxed. 
bwrap network is shared by default. 
bwrap capability dropping is optional. 
An admitted shell command has no semantic destructive-action check. 
An admitted MCP tool has no argument-level resource authorization in `mcpGrants`. 
An allowed result has no secret scrub. 
An allowed result has no prompt-injection trust label. 
Issue 1123 controls do not exist until implemented and approved.

## Destructive-action scorecard

| action | opencode | eve | Flue | boring-ui |
|---|---|---|---|---|
| Delete one workspace file through file API | edit permission; default often silent | silent unless tool policy | silent | confined, silent |
| Recursive workspace deletion via shell | shell rule; broad allow can be silent | silent unless wrapped | silent | silent once bash admitted |
| Delete outside workspace | external prompt for file tool; shell argument gap | sandbox/provider dependent | virtual safe, local unsafe | runsc/bwrap namespace safe; direct unsafe |
| Follow symlink outside on read | documented reject; implementation boundary not fully proven | provider dependent | provider dependent | runsc rejects; node API realpath rejects |
| Follow symlink outside on write | documented reject | provider dependent | provider dependent | runsc rejects; node target/parent rejects with TOCTOU caveat |
| Force push | shell policy only | no special handling | no special handling | no special handling; network may block |
| Install package | shell policy only | no special handling | no special handling | no special handling; runsc network blocks fetch |
| `curl | sh` | shell policy only | no special handling | virtual network policy helps | runsc blocks network; bwrap/direct do not |
| Rewrite git history locally | shell policy only | no special handling | no special handling | no special handling |
| Device/proc access | host process | backend dependent | backend dependent | runsc/bwrap namespaces; direct host | 
The common failure is intent blindness. 
All four systems can know “a shell tool is running” without knowing “this mutates shared history.” 
String matching is not a robust substitute for command semantics. 
Sandboxing constrains blast radius but does not protect authorized in-workspace data. 
The right design combines capability admission, semantic high-risk interception, and containment.

## Path attack test vectors

| vector | opencode | eve | Flue | boring-ui |
|---|---|---|---|---|
| `../etc/passwd` file API | should become external/deny | unspecified cross-provider | accepted/normalized depending adapter | rejected |
| `..%2Fetc%2Fpasswd` | unspecified | unspecified | unspecified | decoded then rejected |
| `..\\etc\\passwd` | platform-normalized | unspecified | adapter/platform | normalized then rejected |
| `/etc/passwd` | external approval possible | backend dependent | local accepts | file API/runsc reject; direct shell can read |
| `C:\\Windows\\System32` | Windows-normalized external | backend dependent | backend dependent | rejected by boring-bash |
| `//server/share` | external | backend dependent | backend dependent | rejected by boring-bash |
| `~/.ssh/id_rsa` | permission patterns expand home | shell expands | local shell expands | boring-bash rejects; direct shell expands |
| `$HOME/.ssh/id_rsa` | permission config expands home | shell expands | local shell expands | boring-bash rejects; direct shell expands |
| symlink inside to outside | docs reject | backend dependent | no generic promise | runsc rejects; node file API rejects |
| symlink swap after check | no kernel-anchored proof | no generic proof | no generic proof | runsc resistant; node API vulnerable window |
| `/proc/self/environ` | external/read or shell policy | sandbox dependent | virtual absent; local present | runsc namespace, bwrap proc present, direct host proc |
| `/tmp/secret` | managed temp exceptions/host shell | backend dependent | virtual ephemeral/local host | bwrap/runsc private tmpfs; direct host tmp |
| newline in path | unspecified | unspecified | unspecified | rejected |
| null byte | runtime rejection likely | runtime rejection likely | runtime rejection likely | explicitly rejected |
| path ending spaces | platform dependent | platform dependent | platform dependent | corpus includes it; semantics provider dependent |

## Ranked adoption list

1. Make a single mandatory pre-execution authorization seam for every model-originated side effect.

   It must cover native tools, MCP, shell, file operations, subagents, and future plugins.

   Tool omission remains useful, but omission alone cannot police alternate paths.

2. Adopt Eve's durable approval continuation protocol.

   Persist request identity, exact validated arguments, policy version, decision, actor, expiry, and resumption state.

   Bind every answer cryptographically to the exact pending request and immutable call snapshot.

3. Adopt OpenCode's resource-aware permission UX, but not raw string matching as the enforcement core.

   Users need path, URL, command, connector/tool, and agent scopes.

   Internally compile those scopes to typed capabilities.

4. Make runsc-style dirfd/openat2 resolution the normative filesystem contract.

   Port it to every host-backed file provider where Linux supports it.

   On unsupported platforms, use provider-native handles or reject high-risk operations.

5. Eliminate or loudly quarantine the direct provider for model-driven untrusted work.

   Require an explicit trusted-development flag.

   Emit a persistent UI warning and audit event.

6. Change bwrap defaults to isolated network and drop-all-capabilities.

   Require explicit egress grants and explicit capability additions.

7. Ship issue 1123 mount-set lease keying and canonical source binding.

   Revalidate mount source identity at use time or hold stable directory handles to reduce TOCTOU.

8. Add typed egress grants.

   Separate DNS, destination host, port, protocol, method, and credential binding.

   Do not equate web-tool URL permission with shell egress authorization.

9. Add semantic high-risk action interception.

   At minimum cover recursive deletion, force push, branch deletion, destructive database commands, package install, permission changes, and credential export.

   Prefer argv/operation APIs over shell-text heuristics.

10. Generalize runsc credential references into a platform secret broker.

    Keep values out of model arguments, durable state, normal logs, and replay buffers.

    Bind each lease to workspace, agent, tool, operation, destination, and expiry.

11. Add output-side secret controls.

    Track leased secret fingerprints and structured credential fields.

    Scrub model output, logs, traces, error objects, and streaming callbacks before release.

    Treat a match as a security event, not merely text replacement.

12. Adopt Flue's explicit trace-content controls as a platform default, inverted to safe.

    Content capture should be off unless an operator opts in for a bounded purpose.

    Redaction transforms must run before exporter queues.

13. Add source provenance to every context item.

    Mark user, trusted policy, workspace, web, MCP, tool, and generated content distinctly.

    Preserve provenance through summaries and memory.

14. Couple trust to capability.

    A model turn influenced by untrusted web/MCP/file content should not gain new high-risk capabilities without fresh user approval.

    This is more defensible than pretending prompt injection can be filtered perfectly.

15. Add OpenCode-style approval review and revocation UI.

    Show exact compiled scope, origin, last use, expiry, and affected pending calls.

    Never let an “always” click silently release unrelated pending calls.

16. Add provider qualification tests for path and process confinement.

    Run the existing traversal corpus against file APIs and shell paths.

    Include symlink races, bind-source swaps, mount shadowing, procfs, temp, and abort-after-fork cases.

17. Make failure mode part of every control's type.

    Required controls fail closed.

    Optional integrations may fail degraded only by mounting zero capability and emitting a durable diagnostic.

18. Unify decision audit records.

    Record requested capability, compiled scope, matched rule, policy version, actor, result, and execution outcome.

    Keep secret values and raw sensitive content out of that record.

## GAPS IN OURS THAT NONE OF THEM FILLS EITHER

These are not reasons to wait. 
They are areas where copying a reference would preserve the gap.

### 1. No structural prompt-injection containment

None assigns enforceable trust types to context. 
None prevents retrieved text from behaving as instructions at model inference time. 
None propagates provenance through summaries, memories, or subagent handoffs. 
None reduces capability automatically after untrusted content influences a turn.

### 2. No complete output exfiltration barrier

All can deliver a secret safely and then let the invoked process print it. 
None guarantees value-aware scrubbing before model context. 
None guarantees the same scrub before logs, traces, error reporting, and streaming callbacks. 
None handles transformed secrets such as base64, URL encoding, substrings, or derived tokens robustly.

### 3. No shell semantic model

All permit arbitrary shell somewhere. 
None reliably identifies compound commands, substitutions, generated scripts, interpreters, or alias expansion. 
None can prove a command's filesystem and network effects before execution. 
Approval over raw text is weak evidence of informed consent.

### 4. No transaction boundary for side effects

None can roll back arbitrary filesystem, git, network, or external-service mutation after partial failure. 
None provides universal exactly-once execution. 
None resolves the ambiguity when a remote side effect succeeds and the response is lost. 
Idempotency remains tool-specific.

### 5. No universal authorization of tool results

Policies focus on calls, not returned data. 
A permitted tool may return a different tenant's data, excessive fields, or hidden credentials. 
None validates result scope against the original capability before exposing it to the model.

### 6. No provenance-safe memory

Untrusted content can be summarized and later lose its source label. 
None specifies how approval-sensitive facts survive compaction. 
None prevents poisoned memory from becoming apparently trusted local context.

### 7. No confused-deputy defense across chained tools

A low-trust read can influence a high-authority write. 
Per-call approval does not express information-flow constraints. 
None tracks which sources causally influenced a requested action.

### 8. No comprehensive mount race defense

Our runsc in-guest path walk is excellent, but the host bind source can still change before container mount. 
OpenCode permissions do not solve it. 
Eve and Flue delegate it to providers. 
Issue 1123's one-time realpath is still check-then-bind unless backed by stable handles/provider primitives.

### 9. No safe universal temp contract

Private tmpfs is good but not universal. 
None specifies secret lifetime, cleanup proof, quotas, executable bits, cross-process visibility, and crash recovery for temp data across every provider.

### 10. No policy for generated executables

An allowed write can create a script or binary. 
A later generic execute permission can run it. 
None binds execute authority to artifact provenance, review state, or content digest.

### 11. No dependency-install trust chain

Package installation is treated as shell plus network. 
None requires lockfile integrity, registry allowlists, signature/provenance checks, lifecycle-script restrictions, or immutable caches as one control.

### 12. No comprehensive covert-channel budget

Network denial does not stop all channels. 
Output timing, error text, DNS where available, shared caches, git metadata, and user-facing questions can carry data. 
None models an exfiltration budget across channels.

### 13. No policy-drift proof

None proves that the policy shown to the user is the policy enforced at execution after deployment/config changes. 
Approval records need a digest of tool schema, executor, policy, provider profile, mounts, and credential scope.

### 14. No universal revocation during execution

Revoking a grant usually affects future calls. 
None guarantees interruption and cleanup of a currently running process or outbound request. 
Long-lived shells and background children are especially difficult.

### 15. No trustworthy human-consent UX standard

None guarantees the approval display is complete, non-spoofable, and understandable. 
Tool-provided descriptions can omit side effects. 
Prompt content can pressure or mislead the approver. 
The UI needs independently computed risk facts.

### 16. No formal least-privilege composition

Tool admission, mounts, shell, egress, secrets, and approval are separate axes. 
None provides a capability algebra proving the effective authority is their intersection. 
Without that, alternate execution paths create privilege surprises.

### 17. No robust policy for nested agents

Subagents can inherit context and indirectly exercise parent capabilities. 
None fully specifies attenuation, delegation depth, revocation propagation, and result trust across nested agents.

### 18. No content-aware data-loss prevention with acceptable false-positive control

Simple regex redaction misses transformed data and over-redacts benign text. 
None combines structured labels, leased-secret fingerprints, classifiers, and destination policy into a dependable release gate.

### 19. No security boundary for observability operators

Trace exporters and log readers become high-value principals. 
None of the four models fully defines least-privilege access, retention, deletion, and audit for captured model/tool content.

### 20. No end-to-end proof across provider substitution

The same `Sandbox` or `Environment` interface can mean virtual isolation, gVisor, bwrap, or direct host execution. 
None makes unsafe substitution impossible at the type/configuration boundary. 
Security claims must therefore name the provider profile, not only the interface.

## Concrete release gates for boring-ui

Do not describe ask-user as an approval system until it intercepts and resumes exact calls. 
Do not describe governance as filesystem confinement. 
Do not describe MCP grants as argument-level resource authorization. 
Do not describe bwrap as network-isolated with its current default. 
Do not describe direct as a sandbox. 
Do not describe issue 1123 as shipped. 
Do not claim symlink safety without naming the provider and operation path. 
Do not claim secret safety without testing stdout, stderr, errors, traces, and callbacks. 
Do not claim prompt-injection resistance based only on tool allowlisting. 
Do not claim failure-closed behavior for an optional integration that silently retains another execution path. 
Ship a provider-profile badge in every execution audit record. 
Ship a negative test proving direct cannot be selected in untrusted mode. 
Ship an egress-denied test for bwrap default configuration after changing it. 
Ship bind-source symlink-swap tests. 
Ship secret echo tests across every output and telemetry seam. 
Ship malicious MCP/file/web instruction tests that verify capability attenuation. 
Ship approval replay, stale answer, wrong actor, wrong session, and changed-arguments tests. 
Ship policy-digest mismatch rejection between approval and execution.

## Source index

### OpenCode

- Official v2 permission contract: https://opencode.ai/v2/docs/permissions

- Public permission implementation: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/permission/index.ts

- External-directory helper: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/external-directory.ts

- Read tool: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/read.ts

- Edit tool: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/edit.ts

- MCP integration: https://github.com/anomalyco/opencode/tree/dev/packages/opencode/src/mcp

- v2 specification tree: https://github.com/anomalyco/opencode/tree/dev/specs/v2

### Eve

- Human in the loop: https://github.com/vercel/eve/blob/main/docs/tools/human-in-the-loop.md

- Multi-tenant approval pattern: https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-approvals.md

- Multi-tenant auth pattern: https://github.com/vercel/eve/blob/main/docs/patterns/multi-tenant-auth.md

- Approval definitions: https://github.com/vercel/eve/blob/main/packages/eve/src/public/definitions/approval.ts

- Approval helpers: https://github.com/vercel/eve/blob/main/packages/eve/src/public/tools/approval/approval-helpers.ts

- Authorization/model-facing redaction: https://github.com/vercel/eve/blob/main/packages/eve/src/harness/authorization.ts

- Version manifest: https://github.com/vercel/eve/blob/main/packages/eve/package.json

- Vercel Eve documentation: https://vercel.com/docs/eve

### Flue

- `npx -y @flue/cli@2.0.3 docs read guide/tools`

- `npx -y @flue/cli@2.0.3 docs read reference/sandbox-api`

- `npx -y @flue/cli@2.0.3 docs read guide/sandboxes`

- `npx -y @flue/cli@2.0.3 docs read reference/agent-api`

- Additional pinned reads used for failure/telemetry checks: `reference/agent-behavior`, observability, and errors.

### boring-ui

- `packages/agent/src/server/agent-host/mcpGrants.ts` at `origin/main`

- `packages/boring-bash/src/server/workspace/paths.ts` at `origin/main`

- `packages/boring-sandbox/src/providers/node-workspace/paths.ts` at `origin/main`

- `packages/boring-sandbox/src/providers/direct/createDirectSandbox.ts` at `origin/main`

- `packages/boring-sandbox/src/providers/bwrap/buildBwrapArgs.ts` at `origin/main`

- `packages/boring-sandbox/src/providers/bwrap/createBwrapSandbox.ts` at `origin/main`

- `packages/boring-sandbox/src/providers/runsc/runtime/dockerArgv.ts` at `origin/main`

- `packages/boring-sandbox/src/providers/runsc/runtime/invocationCredentials.ts` at `origin/main`

- `packages/boring-sandbox/src/providers/runsc/runtime/invocationEnvelope.ts` at `origin/main`

- `packages/boring-sandbox/src/providers/runsc/runtime/sessionRuntime.ts` at `origin/main`

- `packages/boring-sandbox/src/providers/runsc/runtime/workload/cmd/boring-runtime/workspace.go` at `origin/main`

- `packages/boring-sandbox/src/shared/invocationSecretsV1.ts` at `origin/main`

- `docs/issues/1123/plan.md` at `origin/main`

- `plugins/ask-user/**` at `origin/main`

- `plugins/boring-governance/**` at `origin/main`
