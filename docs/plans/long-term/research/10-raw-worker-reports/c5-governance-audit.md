<table>
<thead>
<tr><th>Control</th><th>Documented guarantee</th><th>Actual implementation (origin/main file:line)</th><th>Classification</th><th>Gap</th></tr>
</thead>
<tbody>

<tr><td>D29 — <code>AuthorizedAgentScope</code> unique-symbol brand</td><td>
The scope is an issuer-owned runtime capability rather than a transport DTO.<br>
The <code>unique symbol</code> brand means it cannot be forged by spreading an object across a boundary.<br>
Possession alone is not authorization.
</td><td>
<code>packages/agent/src/shared/gateway/types.ts:38-48</code> declares<br>
<code>declare const authorizedAgentScope: unique symbol</code><br>
and uses it only as an interface property.<br>
Because the symbol is declared rather than instantiated/exported, it emits no runtime value.<br>
First-party issuers create ordinary two-field objects and cast them:<br>
Core at <code>packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:344-350</code>;<br>
Workspace at <code>packages/workspace/src/app/server/createWorkspaceAgentServer.ts:347-360</code>;<br>
CLI at <code>packages/cli/src/server/modeApps.ts:45-57</code>;<br>
playground at <code>apps/agent-playground/src/server/agentHost.ts:37-50</code>;<br>
standalone at <code>packages/agent/src/server/createStandaloneAgentHostApp.ts:95-103</code>.<br>
The Host's <code>verify()</code> performs no brand test; it delegates to the injected verifier at<br>
<code>packages/agent/src/server/agent-host/createAgentHost.ts:340-346</code>.<br>
A plain object of the right shape is therefore accepted whenever the injected verifier accepts it.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
The TypeScript brand is compile-time only.<br>
The documentation incorrectly attributes runtime non-forgeability to <code>unique symbol</code>.<br>
Runtime provenance exists in first-party issuers, but it is a separate WeakMap/WeakSet/reference-identity control.<br>
The generic Host contract permits a permissive verifier.
</td></tr>

<tr><td>D29 — first-party runtime issuer provenance</td><td>
Only an issuer-minted capability is usable.<br>
Spreading, JSON round-tripping, or constructing the visible fields must not mint authority.
</td><td>
Core stores scopes in a private <code>WeakMap</code> and rejects unrecorded or mutated objects at<br>
<code>packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:334-380</code>.<br>
Workspace stores issuer context in a private <code>WeakMap</code> and rejects unrecorded objects at<br>
<code>packages/workspace/src/app/server/createWorkspaceAgentServer.ts:347-378</code>.<br>
CLI binds scopes to <code>LocalWorkspace</code> objects in a private <code>WeakMap</code> at<br>
<code>packages/cli/src/server/modeApps.ts:45-76</code>.<br>
Standalone uses a private <code>WeakSet</code> at<br>
<code>packages/agent/src/server/createStandaloneAgentHostApp.ts:95-113</code>.<br>
Playground checks exact object identity at<br>
<code>apps/agent-playground/src/server/agentHost.ts:41-55</code>.<br>
A spread/plain object is not present in those registries and is rejected.
</td><td><strong>ENFORCED-BY-CODE</strong></td><td>
This control genuinely holds for the shipped first-party issuers.<br>
It is not structural: deleting the issuer registry check, or injecting a permissive verifier, removes the protection.<br>
The guarantee should name object-identity provenance as the enforcement mechanism.
</td></tr>

<tr><td>D29 — Core issuer identity and current membership</td><td>
Every use must be re-checked against issuer identity and current workspace membership.
</td><td>
Core checks the private issuer record and compares both visible fields at<br>
<code>packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:371-380</code>.<br>
It then reloads the workspace, user, and membership in parallel at<br>
<code>packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:381-385</code>.<br>
It rejects missing workspace, wrong app, missing user, or removed membership at<br>
<code>packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:386-388</code>.<br>
Every later call that reaches this verifier sees current database state.
</td><td><strong>ENFORCED-BY-CODE</strong></td><td>
Verified for Core gateway operations that actually invoke <code>verify()</code>.<br>
This does not automatically revoke already-admitted streams, callbacks, leases, or in-flight effects.<br>
It is code enforcement, not an unbypassable structural property.
</td></tr>

<tr><td>D29 — Workspace, CLI, standalone, and playground membership freshness</td><td>
Every scope use is checked against current membership, regardless of host surface.
</td><td>
Workspace verifies only WeakMap provenance and fixed workspace ID at<br>
<code>packages/workspace/src/app/server/createWorkspaceAgentServer.ts:364-378</code>.<br>
CLI verifies only WeakMap provenance and the fixed local subject at<br>
<code>packages/cli/src/server/modeApps.ts:62-70</code>.<br>
Standalone verifies only WeakSet provenance at<br>
<code>packages/agent/src/server/createStandaloneAgentHostApp.ts:105-112</code>.<br>
Playground verifies only exact reference identity at<br>
<code>apps/agent-playground/src/server/agentHost.ts:46-55</code>.<br>
These local surfaces do not consult a membership store on use.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
The universal wording is too broad.<br>
These surfaces intentionally model trusted-local/fixed-workspace authority, not revocable membership.<br>
Either scope D29's current-membership claim to membership-bearing Core hosts or require a common revocation-aware verifier contract.
</td></tr>

<tr><td>D29 — seven top-level <code>AgentGateway</code> operations</td><td>
Possession is not authorization; every scope-consuming operation re-verifies.
</td><td>
<code>listAgents</code> verifies at <code>packages/agent/src/server/agent-host/embeddedGateway.ts:250-252</code>.<br>
<code>listSessions</code> verifies at <code>embeddedGateway.ts:264-266</code>.<br>
<code>createSession</code> verifies at <code>embeddedGateway.ts:293-295</code>.<br>
<code>readSessionState</code> verifies at <code>embeddedGateway.ts:354-356</code>.<br>
<code>connectSession</code> verifies at <code>embeddedGateway.ts:375-377</code>.<br>
<code>renameSession</code> verifies at <code>embeddedGateway.ts:531-533</code>.<br>
<code>deleteSession</code> verifies at <code>embeddedGateway.ts:548-550</code>.<br>
The private verifier delegates through the Host at <code>embeddedGateway.ts:245-248</code>.
</td><td><strong>ENFORCED-BY-CODE</strong></td><td>
This control genuinely holds for all seven gateway entry methods.<br>
The strength of the result still depends on the injected issuer verifier.<br>
Deleting these calls removes the check; no structural boundary independently prevents access.
</td></tr>

<tr><td>D29 — commands on an open session connection</td><td>
An authorization check at connection time is insufficient; each later command must re-check authority.
</td><td>
The connection creates a <code>reverify</code> closure at<br>
<code>packages/agent/src/server/agent-host/embeddedGateway.ts:418-421</code>.<br>
<code>send</code> re-verifies at <code>embeddedGateway.ts:425-427</code>.<br>
<code>interrupt</code> re-verifies at <code>embeddedGateway.ts:429-431</code>.<br>
<code>stop</code> re-verifies at <code>embeddedGateway.ts:442-444</code>.<br>
<code>clearQueue</code> re-verifies at <code>embeddedGateway.ts:453-455</code>.<br>
Each command then resolves the current session binding where needed.
</td><td><strong>ENFORCED-BY-CODE</strong></td><td>
This documented sub-control genuinely holds.<br>
After Core membership removal, the next command fails once the live membership lookup completes.<br>
An effect already past verification is not cancelled by membership removal.
</td></tr>

<tr><td>D29 — events on an open session connection</td><td>
Every use, including ongoing delivery through a possessed connection, is re-checked against current membership.
</td><td>
<code>connectSession</code> verifies once, subscribes, and closes over the original claim at<br>
<code>packages/agent/src/server/agent-host/embeddedGateway.ts:375-396</code>.<br>
The returned <code>events</code> iterable is the queue at <code>embeddedGateway.ts:422-424</code>.<br>
The subscription callback pushes events without another verifier call at <code>embeddedGateway.ts:388-395</code>.<br>
The connection ends only on explicit close, Host close, or underlying service termination at<br>
<code>embeddedGateway.ts:406-417</code>.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
Membership removal does not revoke an already-open event stream.<br>
There is no TTL, membership-change listener, per-event check, or maximum stream lifetime.<br>
Authority can persist until connection/Host close; the time bound is <strong>none</strong>.
</td></tr>

<tr><td>D29 — activity SSE and other long-lived HTTP projections</td><td>
Current authorization is checked throughout long-lived use, not only at transport establishment.
</td><td>
The activity SSE resolves an authorized workspace once at<br>
<code>packages/agent/src/server/agent-host/httpProjection.ts:233-240</code>.<br>
It subscribes and forwards updates without re-verification at<br>
<code>httpProjection.ts:243-268</code>.<br>
Runtime-capability authorization is cached once per <code>FastifyRequest</code> at<br>
<code>packages/agent/src/server/agent-host/runtimeCapabilityProjection.ts:163-178</code>.<br>
Resolved bindings are also cached per request/address at<br>
<code>runtimeCapabilityProjection.ts:566-579</code>.<br>
Ready-status streaming receives the already-authorized tracker at<br>
<code>runtimeCapabilityProjection.ts:636-641</code>.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
Authorization is connection/request admission, not every stream use.<br>
No revocation epoch or finite stream TTL exists.<br>
Membership authority persists until socket close or Host drain; the time bound is <strong>none</strong>.
</td></tr>

<tr><td>D29 — Environment HTTP lease use</td><td>
Every Environment operation re-checks issuer identity and membership.
</td><td>
Environment HTTP projection authorizes and acquires one lease per request at<br>
<code>packages/agent/src/server/agent-host/environmentHttpProjection.ts:29-57</code>.<br>
All workspace, git, search, and binding getters reuse that lease at<br>
<code>environmentHttpProjection.ts:79-109</code>.<br>
Finite requests release on response/error at <code>environmentHttpProjection.ts:72-77</code>.<br>
Filesystem-event streams defer release until transport close at<br>
<code>environmentHttpProjection.ts:90-98</code>.<br>
The lease's operation guards check only active/released state at<br>
<code>packages/agent/src/server/agent-host/createAgentHost.ts:787-832</code>.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
Finite requests are re-authorized on the next request, but not between operations within one request.<br>
An in-flight finite operation persists until completion, with no explicit authorization deadline.<br>
A streaming filesystem lease persists until socket close or Host drain, with no finite revocation bound.
</td></tr>

<tr><td>D29 — callback-scoped dispatcher lease</td><td>
Every operation performed through a leased agent/workspace capability re-checks current membership.
</td><td>
The dispatcher verifies once before resolving the runtime and Environment at<br>
<code>packages/agent/src/server/agent-host/workspaceAgentLease.ts:93-120</code>.<br>
It then exposes proxy-guarded workspace operations at<br>
<code>workspaceAgentLease.ts:218-229</code>.<br>
The guards enforce lease activity and teardown, not membership, at<br>
<code>workspaceAgentLease.ts:17-83</code>.<br>
Dispatch, interrupt, and stop are fenced against disposal at<br>
<code>workspaceAgentLease.ts:230-269</code>.<br>
Shutdown uses a configurable grace deadline at <code>workspaceAgentLease.ts:149-205</code>, but membership removal does not trigger it.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
The lease is safe against use-after-release and Host shutdown.<br>
It is not revocation-aware.<br>
After membership removal, authority persists until callback completion or Host drain; there is no membership-based time bound.
</td></tr>

<tr><td>D29 — <code>createAgentHost()</code> as the observed construction funnel</td><td>
All first-party consumers obtain the gateway through one Host-owned construction funnel.
</td><td>
The factory creates the runtime and the sole observed production <code>EmbeddedAgentGateway</code> instance in<br>
<code>packages/agent/src/server/agent-host/createAgentHost.ts:694-725</code>.<br>
The returned <code>CreatedAgentHost</code> freezes together host, gateway, Environment acquisition, dispatcher, and routes at<br>
<code>createAgentHost.ts:859-882</code>.<br>
Current production callers are the five app composition roots listed in<br>
<code>scripts/check-alignment-invariants.mjs:40-59</code>.<br>
Repository search on <code>origin/main</code> found no production <code>new EmbeddedAgentGateway</code> outside the factory.
</td><td><strong>ENFORCED-BY-CODE</strong></td><td>
The funnel empirically holds on current <code>origin/main</code>.<br>
It is not structural because the gateway class and public constructor are exported.<br>
Future bypasses remain possible unless module/API visibility is narrowed.
</td></tr>

<tr><td>D29 — CI invariant for the construction funnel</td><td>
CI forbids every construction path outside <code>createAgentHost()</code> and proves the funnel is singular.
</td><td>
The invariant defines a nine-file allowlist at<br>
<code>scripts/check-alignment-invariants.mjs:40-59</code>.<br>
It parses production source while excluding tests, fixtures/templates, build outputs, and skipped directories at<br>
<code>check-alignment-invariants.mjs:14-32,65-86,358-359</code>.<br>
Its AST heuristic recognizes identifiers, property access, literal element access, import aliases, simple assignment, and destructuring at<br>
<code>check-alignment-invariants.mjs:202-267</code>.<br>
Its negative fixture covers those forms at <code>check-alignment-invariants.mjs:324-340</code>.<br>
It reports calls outside the allowlist at <code>check-alignment-invariants.mjs:385-398</code>.<br>
Root <code>package.json:13-14</code> includes it in <code>lint:invariants</code>.<br>
<code>.github/workflows/invariants.yml:46-50</code> runs the invariant suite on PRs and main pushes.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
It catches direct calls, namespace/property calls, literal <code>['createAgentHost']</code>, imported aliases, simple aliases, and destructuring.<br>
It does not resolve renamed re-exports across modules, differently named wrappers/helpers, computed property names, or production imports of excluded test helpers.<br>
It does not scan <code>new</code> expressions for alternate construction.<br>
<code>EmbeddedAgentGateway</code> is publicly exported at <code>packages/agent/src/server/index.ts:165,176</code> and has a public constructor at <code>embeddedGateway.ts:128-140</code>.<br>
The CI rule is a useful heuristic, not proof of all construction paths.
</td></tr>

<tr><td>D28 — Agents receive operations/capabilities, not governance policy sources</td><td>
Governance policy remains host-side.<br>
Agents receive attenuated Environment operations, not policy maps, membership records, or Sandbox administration.
</td><td>
Governance derives access from a verified user and returns no binding for disabled, unidentified, ungranted, or same-context cases at<br>
<code>plugins/boring-governance/src/server/filesystemBindings.ts:273-288</code>.<br>
Admin access becomes a concrete store-operations vtable at<br>
<code>filesystemBindings.ts:290-314</code>.<br>
Ordinary access becomes a rule-filtered readonly operations vtable at<br>
<code>filesystemBindings.ts:316-365</code>.<br>
Agent composition merges only <code>RuntimeFilesystemBinding</code> operations and builds tools at<br>
<code>packages/agent/src/server/agent-host/buildAgentComposition.ts:181-218</code>.<br>
No <code>GovernanceService</code>, policy map, membership store, or provider administration object enters the harness.
</td><td><strong>ENFORCED-BY-CODE</strong></td><td>
This control genuinely holds on the full-app path.<br>
Deleting the governance checks inside the callback would widen the returned vtable; no independent Host policy engine would stop it.<br>
Therefore the attenuation is legitimate code enforcement, not structural enforcement.
</td></tr>

<tr><td>D28 — where Environment attenuation is applied</td><td>
Governance compiles authorized invocation context into attenuated Environment admission.
</td><td>
Core creates a filesystem-binding resolver from the verified claim and request principal at<br>
<code>packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:1479-1502</code>.<br>
It also places the resolver on the agent runtime scope at<br>
<code>createCoreWorkspaceAgentServer.ts:1536-1550</code>.<br>
For direct app Environment acquisition, Host first verifies and resolves Environment, then acquires the provider lease at<br>
<code>packages/agent/src/server/agent-host/createAgentHost.ts:773-786</code>.<br>
Only after provider acquisition does it call <code>resolveFilesystemBindings</code> and merge results at<br>
<code>createAgentHost.ts:799-808</code>.<br>
It guards the returned operation objects at <code>createAgentHost.ts:809-832</code>.<br>
For agent file tools, bindings resolve dynamically through<br>
<code>buildAgentComposition.ts:181-215</code>.
</td><td><strong>ENFORCED-BY-CODE</strong></td><td>
Attenuation is applied by Host projection/tool binding after provider Environment acquisition, not encoded in provider admission or lease identity.<br>
The caller cannot submit arbitrary bindings over transport, but the app-owned resolver is trusted enforcement code.<br>
D28 should use “authorized Host projection” rather than implying provider-level admission.
</td></tr>

<tr><td>D28 — full-app governance composition</td><td>
When governance is installed, its authorization, model, budget, and filesystem controls are active on the production path.
</td><td>
<code>createGovernance()</code> returns service, server plugin, model filter, metering wrapper, filesystem resolver, and Pi policy at<br>
<code>plugins/boring-governance/src/server/index.ts:60-68,82-108</code>.<br>
Production full-app wires the plugin and all enforcement seams at<br>
<code>apps/full-app/src/server/main.ts:40-58</code>.<br>
Development full-app does the same at<br>
<code>apps/full-app/src/server/dev.ts:99-116</code>.<br>
The model picker is filtered at <code>plugins/boring-governance/src/server/index.ts:116-134</code>.<br>
The metering/admission path separately enforces allowed model and budgets before execution at<br>
<code>plugins/boring-governance/src/server/metering.ts:56-105</code>,<br>
and the chat service awaits admission before model execution at<br>
<code>packages/agent/src/server/pi-chat/harnessPiChatService.ts:403-433</code>.
</td><td><strong>ENFORCED-BY-CODE</strong></td><td>
The concrete first-party full-app wiring genuinely holds.<br>
It is not structural: the seams are separate optional properties and can be partially wired by another host.<br>
Deleting <code>getFilesystemBindings</code> removes company-context admission; deleting governance metering removes execution-time model/budget admission while leaving picker filtering.
</td></tr>

<tr><td>D28 — atomic governance-plugin integration contract</td><td>
Installing the governance plugin necessarily installs the corresponding enforcement capabilities.
</td><td>
The governance result exposes independent fields rather than one opaque capability at<br>
<code>plugins/boring-governance/src/server/index.ts:60-68,93-108</code>.<br>
The server plugin itself only registers governance routes and startup reconciliation at<br>
<code>plugins/boring-governance/src/server/index.ts:137-150</code>.<br>
Model filtering, metering, filesystem attenuation, and strict model resolution must be separately supplied by the host.<br>
No Host type or CI invariant requires those seams when <code>governance.serverPlugin</code> is present.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
A host can install governance UI/routes but omit one or all enforcement hooks.<br>
Full-app is correct today, but the reusable plugin contract does not make partial composition impossible or fail closed.<br>
The generic D28 guarantee is therefore stronger than the integration boundary.
</td></tr>

<tr><td>D28 — governance policy and grant revocation freshness</td><td>
Current policy/grants govern each invocation; revocation should have a defined persistence bound.
</td><td>
Governance reads and validates YAML once at startup at<br>
<code>plugins/boring-governance/src/server/loadPolicy.ts:33-90</code>.<br>
<code>createGovernance()</code> constructs one service from that snapshot at<br>
<code>plugins/boring-governance/src/server/index.ts:82-107</code>.<br>
The service retains the loaded result at<br>
<code>plugins/boring-governance/src/server/governanceService.ts:59-83</code>.<br>
Company-context access and regex rules are derived from that same snapshot at<br>
<code>filesystemBindings.ts:273-331</code>.<br>
No file watcher, reload API, generation check, or invalidation path was found.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
A policy membership, model grant, budget, or company-context rule change has no live time bound.<br>
It takes effect after process restart.<br>
The actual persistence bound is therefore <strong>none</strong> in elapsed time; operationally it is “until restart.”
</td></tr>

<tr><td>D28 — per-user binding-cache isolation in generic Core hosts</td><td>
Authorized invocation context must attenuate each user's Environment operations without cross-user reuse.
</td><td>
Core includes <code>userId</code> in runtime identity only when <code>options.getExtraTools</code> exists at<br>
<code>packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:1431-1439</code>.<br>
Its filesystem resolver closes over the authorization-time <code>request</code> at<br>
<code>createCoreWorkspaceAgentServer.ts:1479-1493</code><br>
and is stored in the runtime scope at <code>createCoreWorkspaceAgentServer.ts:1544-1550</code>.<br>
Host binding keys omit auth subject and use agent, workspace, resolved identity, provisioning fingerprint, and physical identity at<br>
<code>packages/agent/src/server/agent-host/createAgentHost.ts:396-404</code>.<br>
Governance prefers the captured <code>request.user</code> principal at<br>
<code>plugins/boring-governance/src/server/filesystemBindings.ts:122-141</code>.<br>
Full-app happens to pass <code>getExtraTools</code> at <code>apps/full-app/src/server/main.ts:57</code>, making its identity user-specific.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
A Core host with per-user <code>getFilesystemBindings</code> but no <code>getExtraTools</code> can reuse a binding whose resolver captured the first user's request.<br>
The full-app is incidentally protected by unrelated configuration.<br>
Subject/policy identity must be unconditional whenever a subject-scoped resolver exists, and long-lived bindings should not capture <code>FastifyRequest</code>.
</td></tr>

<tr><td>D25/D26 — authored <code>AgentDefinition</code> is declarative only</td><td>
Authored agent data cannot select executable packages, tools, credentials, MCP commands, models, or runtime policy.
</td><td>
The strict Zod schema admits identity/display/instruction fields and only legacy reference arrays at<br>
<code>packages/agent/src/shared/agent-definition.ts:159-174</code>.<br>
Unknown fields are rejected by <code>.strict()</code> at <code>agent-definition.ts:159-174</code>.<br>
Any non-empty legacy <code>capabilityRequirements</code>, <code>toolRefs</code>, <code>skillRefs</code>, or <code>mcpServerRefs</code> is rejected at<br>
<code>agent-definition.ts:221-230</code>.<br>
The validated output contains only declarative fields at <code>agent-definition.ts:234-244</code>.<br>
Trusted behavior arrives through a separate policy input at<br>
<code>packages/agent/src/server/agentDefinition/createConfiguredAgentHostAgentSpec.ts:15-32,98-134</code>.
</td><td><strong>ENFORCED-BY-CODE</strong></td><td>
This guarantee genuinely holds for the strict authored AgentDefinition/package materialization path.<br>
Deletion of schema validation or trusted-policy separation would remove it, so it is not structural.<br>
The guarantee must remain scoped to authored agent data, not all repository/host configuration.
</td></tr>

<tr><td>D25/D26 — authored skill references and skill HTTP route</td><td>
An authored skill path is declarative content and cannot become an executable import or bypass authorization.
</td><td>
Fleet package <code>pi.skills</code> declarations must exactly match host-owned digest pins at<br>
<code>packages/agent/src/server/agentDefinition/loadConfiguredAgentFleet.ts:413-430</code>.<br>
Skill files are path-contained, regular-file checked, read as UTF-8, and digest-verified at<br>
<code>loadConfiguredAgentFleet.ts:289-320</code>.<br>
Their content is appended as instructions at <code>loadConfiguredAgentFleet.ts:432-453,500-506</code>.<br>
The skills route resolves and loads skill metadata/Markdown at<br>
<code>packages/agent/src/server/http/routes/skills.ts:128-168</code>; it does not dynamically import a handler.<br>
Canonical Host registration authorizes before resolving route inputs at<br>
<code>packages/agent/src/server/agent-host/runtimeCapabilityProjection.ts:589-600</code>.
</td><td><strong>ENFORCED-BY-CODE</strong></td><td>
The canonical full-app path holds.<br>
The reusable route makes <code>authorizeRequest</code> optional at<br>
<code>packages/agent/src/server/http/routes/skills.ts:78-90,190-193</code>, so direct registration can be unauthenticated.<br>
That API-level protection is caller-enforced rather than structural.
</td></tr>

<tr><td>D25/D26 — trusted host configuration selects executable behavior</td><td>
Trusted host plugins own executable behavior; authored agent data does not.<br>
The stronger literal reading “no config data selects behavior” is not promised by D28.
</td><td>
Trusted fleet YAML parses model provider/id/env-var candidates at<br>
<code>packages/agent/src/server/agentDefinition/loadConfiguredAgentFleet.ts:190-225</code><br>
and selects a preferred model from available environment keys at<br>
<code>loadConfiguredAgentFleet.ts:274-286,455-506</code>.<br>
Configured plugin IDs are validated against already-resolved artifacts at<br>
<code>packages/agent/src/server/agent-host/fleetCompiler.ts:76-116</code>.<br>
Workspace projects a configured plugin ID into its preflighted plugin's tools, runtime plugins, packages, and extension paths at<br>
<code>packages/workspace/src/app/server/createWorkspaceAgentServer.ts:764-812</code>.<br>
The projection explicitly does not discover/import packages there at <code>createWorkspaceAgentServer.ts:764-768</code>.
</td><td><strong>ENFORCED-BY-CODE</strong></td><td>
There is a real config-to-executable mapping, but it is in trusted host/fleet policy, not authored AgentDefinition data.<br>
This is consistent with D28 when the trust boundary is stated precisely.<br>
Descriptions should not collapse “authored agent data” and “trusted deployment configuration” into one category.
</td></tr>

<tr><td>D25/D26 — standalone/workspace external plugin paths select executable JS</td><td>
No authored or workspace-controlled data selects executable packages/tools on any shipped surface.
</td><td>
Standalone accepts <code>externalPlugins?: boolean</code> at<br>
<code>packages/agent/src/server/createStandaloneAgentHostApp.ts:79-86</code><br>
and enables external extension/tool loading unless explicitly disabled.<br>
The Pi plugin loader discovers workspace and user extension paths, package entries, and dynamically imports candidates in<br>
<code>packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts:9-12,50-60,97-135,137-193,203-215</code>.<br>
Full-app explicitly sets <code>externalPlugins: false</code> in production at<br>
<code>apps/full-app/src/server/main.ts:40-55</code><br>
and development at <code>apps/full-app/src/server/dev.ts:99-115</code>.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
Workspace/config data can select executable extension modules in standalone/local composition.<br>
That may be correct for a trusted-local authoring tool, but the universal declarative-only claim would be false.<br>
Full-app's production composition correctly disables the path.
</td></tr>

<tr><td>MCP — per-agent grant resolver</td><td>
An agent's declared MCP refs resolve only through exact workspace/agent grants and exact allowed-tool intersection, default deny.
</td><td>
<code>resolveAgentMcpGrants()</code> filters grants by exact workspace and agent at<br>
<code>packages/agent/src/server/agent-host/mcpGrants.ts:109-118</code>.<br>
It drops ungranted refs at <code>mcpGrants.ts:120-129</code>.<br>
It drops unknown connectors under a supplied catalog at <code>mcpGrants.ts:131-143</code>.<br>
It intersects allowed tools with catalog tools at <code>mcpGrants.ts:146-164</code>.<br>
The runtime projection lists current grants and calls the resolver at<br>
<code>packages/agent/src/server/agent-host/runtimeCapabilityProjection.ts:255-270</code><br>
and uses it for agent description at <code>runtimeCapabilityProjection.ts:310-325</code>.
</td><td><strong>ENFORCED-BY-CODE</strong></td><td>
The resolver itself is correct and default-deny.<br>
Deleting it removes metadata filtering, but it does not remove an independent physical boundary because the result is not consumed by live tool execution.<br>
The end-to-end enforcement classification is therefore different from this local function classification.
</td></tr>

<tr><td>MCP — per-agent grants on the live execution path</td><td>
Resolved MCP grants attenuate the executable tool capability; there is no parallel ungranted path.
</td><td>
The projection returns <code>mcpGrants</code> and diagnostics at<br>
<code>packages/agent/src/server/agent-host/runtimeCapabilityProjection.ts:272-281</code>,<br>
but returns executable tools independently as <code>binding.composition.tools</code>.<br>
No production consumer of <code>mcpGrants</code> or <code>mcpGrantDiagnostics</code> exists outside that declaration/assignment path.<br>
Full-app assembles live MCP tools independently through <code>getExtraTools</code> at<br>
<code>apps/full-app/src/server/main.ts:53-58</code>.<br>
Those tools are inserted into Core's runtime tools at<br>
<code>packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:1383-1408</code>.<br>
Agent composition appends <code>runtimeScope.extraTools</code> at<br>
<code>packages/agent/src/server/agent-host/buildAgentComposition.ts:204-218</code>.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
The grant resolver currently controls description/projection metadata, not actual MCP tool availability or invocation.<br>
Deletion test: removing <code>resolveAgentMcpGrants()</code> leaves live MCP execution available through <code>getExtraTools</code>.<br>
This is the closest authorization analogue to the reported D27 BYOK gap: the intended policy seam is not on the live behavior path.
</td></tr>

<tr><td>#1123 — resolved mount set is part of lease identity</td><td>
Exec grants are structurally enforced because grants resolve to a mount set before acquisition and that mount set is part of lease identity.
</td><td>
The repository status says executable environments are not built at<br>
<code>docs/direction/STATE.md:13-15</code><br>
and explicitly says #1123 is a ratified plan with zero implementation at<br>
<code>docs/direction/STATE.md:33-35</code>.<br>
The current lease key is only<br>
<code>[workspaceScopeId, environment.placementIdentity]</code> at<br>
<code>packages/agent/src/server/agent-host/environmentLease.ts:66-73</code>.<br>
<code>ResolvedEnvironmentScope</code> has no mount-set or exec-grant field at<br>
<code>packages/agent/src/server/agent-host/types.ts:218-229</code>.<br>
The structural design exists only in the plan at<br>
<code>docs/issues/1123/plan.md:61-69,158-167</code>.<br>
The planned implementation slices remain listed at <code>docs/issues/1123/plan.md:313-326</code>.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
This control is not implemented.<br>
There is no resolved mount set to include in lease identity.<br>
The Host trusts the app-supplied opaque <code>placementIdentity</code>; it does not canonically derive mount authority itself.<br>
Do not describe #1123 as shipped or structural.
</td></tr>

<tr><td>#1123 — per-agent exec grant gates bash</td><td>
No <code>environment.bash.execute</code> grant means no bash tool; removal of an enforcement helper would still be blocked by structural composition/lease boundaries.
</td><td>
The #1123 plan itself states that no grants vocabulary exists in code at<br>
<code>docs/issues/1123/plan.md:23-40</code>.<br>
Agent composition unconditionally calls <code>buildHarnessAgentTools</code> at<br>
<code>packages/agent/src/server/agent-host/buildAgentComposition.ts:204-216</code>.<br>
The boring-bash builder creates the bash tool at<br>
<code>packages/boring-bash/src/agent/tools/harness/index.ts:78-89,228-240</code>.<br>
Repository search on <code>origin/main</code> found no non-documentation <code>environment.bash.execute</code> or <code>BORING_ENV_MOUNTS</code> implementation.<br>
The plan assigns tool gating to a future slice at<br>
<code>docs/issues/1123/plan.md:323-326</code>.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
There is no enforcement function to apply the deletion test to.<br>
Bash is currently present independently of a per-agent exec grant.<br>
The documented structural guarantee is future design, not current implementation.
</td></tr>

<tr><td>Grant deletion test — governance filesystem bindings</td><td>
Governance access should remain impossible if a single policy helper is accidentally removed only when some independent structure still blocks it.
</td><td>
The governance callback computes access and returns concrete binding operations at<br>
<code>plugins/boring-governance/src/server/filesystemBindings.ts:273-365</code>.<br>
Host merge prevents a same-ID request binding from widening an existing host binding at<br>
<code>packages/agent/src/server/runtime/filesystemBindings.ts:42-95</code>.<br>
However, a new named request binding is accepted as returned at<br>
<code>packages/agent/src/server/runtime/filesystemBindings.ts:103-114</code>.<br>
Removing the entire callback fails closed because <code>company_context</code> disappears.<br>
Removing its principal/rule checks while still returning a broad binding leaves no second governance engine to deny it.
</td><td><strong>ENFORCED-BY-CODE</strong></td><td>
This is a legitimate code-enforced authorization control, not a structural one.<br>
The merge algebra provides defense against widening an existing same-ID binding, but it is not a substitute for grant evaluation.<br>
Documentation should state the actual enforcement point and deletion-test result.
</td></tr>

<tr><td>Grant deletion test — Environment lease identity</td><td>
Lease identity itself prevents authority reuse after grant changes.
</td><td>
The lease manager compares only placement identity and provisioning fingerprint at<br>
<code>packages/agent/src/server/agent-host/environmentLease.ts:66-79</code>.<br>
Resolved runtime identity can include a caller-supplied <code>grants</code> list at<br>
<code>packages/agent/src/server/agent-host/runtimeScopeIdentity.ts:41-61</code>,<br>
but Environment provisioning identity deliberately excludes contribution grants at<br>
<code>runtimeScopeIdentity.ts:64-78</code>.<br>
The current full-app runtime contribution supplies <code>grants</code> only as an identity input, not an independently enforced capability boundary.<br>
No Host-owned canonical grant-to-mount derivation exists.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
Hashing caller-resolved grant strings helps cache separation but does not enforce what those grants mean.<br>
Deleting the policy function that computes accurate identity can cause unsafe sharing; nothing else derives the correct authority.<br>
The structural label is not justified until Host/provider objects physically omit inaccessible resources.
</td></tr>

<tr><td>Lease reclamation and revoked-authority persistence</td><td>
Grant removal retires old authority within a defined bound.
</td><td>
Ordinary <code>release()</code> only decrements a reference counter at<br>
<code>packages/agent/src/server/agent-host/environmentLease.ts:107-116</code>.<br>
Disposal occurs on explicit <code>retire()</code> when references reach zero at<br>
<code>environmentLease.ts:117-123</code><br>
or on Host close at <code>environmentLease.ts:155-197</code>.<br>
Zero-reference records otherwise remain cached.<br>
The #1123 plan acknowledges the current non-reclamation behavior at<br>
<code>docs/issues/1123/plan.md:71-79</code>.<br>
Published bindings are cached by resolved identity at<br>
<code>packages/agent/src/server/agent-host/createAgentHost.ts:396-418</code>.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
No policy/grant revocation signal automatically retires or fences an old lease/binding.<br>
Current governance changes require restart; #1123 revocation is not implemented.<br>
The authority persistence bound is <strong>none</strong> absent explicit Host shutdown/retirement.
</td></tr>

<tr><td>Development and standalone HTTP authentication</td><td>
Relaxed local modes do not silently expose issuer-minted authority in production builds.
</td><td>
Standalone uses sound WeakSet provenance at<br>
<code>packages/agent/src/server/createStandaloneAgentHostApp.ts:95-113</code>,<br>
but issues one fixed HTTP scope and installs auth middleware at<br>
<code>createStandaloneAgentHostApp.ts:152-160,331-351</code>.<br>
If <code>authToken</code> is absent, middleware warns and permits the request at<br>
<code>packages/agent/src/server/http/middleware.ts:89-112</code>.<br>
The factory is exported from the production server surface at<br>
<code>packages/agent/src/server/index.ts:160-161</code><br>
and <code>packages/agent/package.json:25-29</code>.<br>
The stock CLI binds it to loopback at <code>packages/agent/src/bin/boring-agent.ts:129-157</code>.<br>
The stock dev server binds unauthenticated to <code>0.0.0.0</code> at<br>
<code>packages/agent/src/server/dev.ts:15-25</code>.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
Loopback in the stock CLI mitigates its default path, but there is no build-time or <code>NODE_ENV</code> barrier.<br>
A production consumer can export the standalone app without a token, and the dev entry itself listens on all interfaces.<br>
The fixed local capability is then reachable by any network client that can reach the server.
</td></tr>

<tr><td>Agent playground authorization</td><td>
Playground relaxation remains isolated from production authorization guarantees.
</td><td>
Playground creates one fixed reference-checked scope at<br>
<code>apps/agent-playground/src/server/agentHost.ts:37-57</code>.<br>
Its routes always return that scope at<br>
<code>agentHost.ts:118-129</code>.<br>
No user authentication hook is installed in that runtime.<br>
It uses direct mode by default at <code>agentHost.ts:79-81</code>.<br>
The separate full-app production entry does not import this playground composition and explicitly uses Core authorization.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
The playground is intentionally trusted-local and not a production tenant host.<br>
Its isolation is packaging/entrypoint convention rather than a production-build exclusion.<br>
If deployed, it grants every reachable caller the fixed local scope.
</td></tr>

<tr><td>Full-app development login and unverified-email override</td><td>
Development-only authentication relaxations cannot be enabled in production.
</td><td>
The full-app dev login route requires its explicit flag and rejects production mode at<br>
<code>apps/full-app/src/server/dev.ts:33-35,47-83</code>.<br>
The production entry is a separate <code>main.ts</code> composition and never registers the dev-login route.<br>
Governance's unverified-email override returns true only outside production at<br>
<code>plugins/boring-governance/src/server/loadPolicy.ts:29-31</code>.<br>
Production policy load rejects missing email verification or invalid policy at<br>
<code>loadPolicy.ts:62-90</code>.
</td><td><strong>ENFORCED-BY-CODE</strong></td><td>
These specific controls genuinely hold.<br>
They do not cure the separately exported standalone/playground paths.<br>
No gap found in the production guard for these two dev-only switches.
</td></tr>

<tr><td>Production sandbox safety escape hatch</td><td>
Production cannot relax the approved runtime/environment controls accidentally.
</td><td>
Production full-app rejects any mode other than <code>vercel-sandbox</code> at<br>
<code>apps/full-app/src/server/productionSafety.ts:1-10</code>.<br>
However, <code>BORING_ALLOW_UNSAFE_AGENT_MODE=1</code> returns before the check at<br>
<code>productionSafety.ts:2-4</code>.<br>
Production startup calls this guard at <code>apps/full-app/src/server/main.ts:26-28</code>.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
The default production guard is real and fail-closed.<br>
An operator-visible environment escape hatch is reachable in a production build.<br>
If that override is intentional, document it as an approved-risk bypass rather than an invariant.
</td></tr>

<tr><td>Overall D29 authorization claim</td><td>
Issuer-owned, non-forgeable runtime scopes are re-checked against current membership on every use through one CI-protected funnel.
</td><td>
First-party runtime object provenance is enforced by code.<br>
Core current membership is checked on every top-level gateway call and every connection command.<br>
The TypeScript symbol itself is not runtime-checkable.<br>
Streams, Environment requests, and callback leases authorize once and then reuse authority.<br>
Local issuers do not model current membership.<br>
The construction funnel holds empirically, while CI is an incomplete call-name heuristic and the alternate gateway constructor is public.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
D29 materially overstates both the brand and “every use.”<br>
It should be decomposed into verified issuer provenance, Core operation-time membership checks, and explicitly bounded connection/lease semantics.<br>
The current implementation is meaningful, but not the universal runtime-capability guarantee described.
</td></tr>

<tr><td>Overall D28 authorization claim</td><td>
Governance compiles policy into attenuated Environment admission, and Agents receive capabilities rather than policy sources.
</td><td>
Full-app correctly wires model filtering, execution admission/metering, filesystem attenuation, and strict model resolution.<br>
Agents receive operation vtables, not GovernanceService or membership records.<br>
Filesystem attenuation happens after provider acquisition in Host projection/tool resolution.<br>
The generic governance result is non-atomic and optional.<br>
Generic Core binding identity can be configuration-coupled to an unrelated <code>getExtraTools</code> option.<br>
MCP grants are computed but do not attenuate the live MCP tool path.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
The capabilities-not-policy-sources differentiator is real for filesystem/model governance.<br>
The claim is too broad for generic plugin composition and MCP.<br>
Environment “admission” wording should reflect the actual post-acquisition projection boundary.
</td></tr>

<tr><td>Overall D25/D26 declarative-boundary claim</td><td>
Authored agent data is declarative only and cannot select executable packages, tools, credentials, MCP commands, models, or runtime policy.
</td><td>
The strict authored AgentDefinition path enforces this separation and rejects all non-empty legacy behavior refs.<br>
Trusted host/fleet configuration separately chooses plugins, model tiers, and skill instruction content.<br>
Full-app disables external plugin discovery.<br>
Standalone/local Pi paths can dynamically load workspace/user extension modules and packages.
</td><td><strong>CONVENTION-ONLY</strong></td><td>
The guarantee genuinely holds at its intended authored-data boundary.<br>
It must not be generalized to trusted fleet YAML or local standalone workspace plugin configuration.<br>
Standalone's executable authoring path needs an explicit trust-class and production guard.
</td></tr>

</tbody>
</table>

## Remediation list, ordered

1. **Correct the public security claims immediately.**

   - State that the <code>unique symbol</code> is a TypeScript compile-time brand only.
   - Attribute runtime non-forgeability to issuer-private object-identity registries.
   - Replace “re-checked on every use” with an exact matrix:
     top-level gateway calls and connection commands re-check;
     event delivery, SSE, Environment request leases, and dispatcher callbacks do not.
   - State that Core membership revocation is observed on the next verifier-backed operation.
   - State that already-admitted streams and leases have no membership-based time bound.
   - Mark #1123 as ratified design with zero implementation, not a shipped differentiator.
   - State that governance policy-file revocation takes effect only after restart.

2. **Put MCP grants on the actual executable path.**

   - Feed <code>ResolvedMcpConnectorGrant</code> into MCP tool construction and invocation.
   - Intersect the live tool catalog with exact allowed tools before a tool object reaches the harness.
   - Remove or forbid the parallel ungranted <code>getExtraTools</code> MCP composition path.
   - Make connector/tool denial occur again at invocation, not only catalog construction.
   - Add a negative end-to-end test proving an ungranted tool is absent and cannot execute.
   - Add a deletion test proving removal of grant resolution causes fail-closed behavior rather than unchanged execution.
   - Add revocation tests against an already-created binding.

3. **Fix generic Core's subject-scoped binding identity and request capture.**

   - Include auth subject and a policy/grant generation in binding identity whenever any subject-scoped resolver exists.
   - Do not condition user isolation on the unrelated presence of <code>getExtraTools</code>.
   - Do not capture a <code>FastifyRequest</code> inside a reusable runtime binding.
   - Pass the current verified invocation claim and current principal attributes to the resolver per operation.
   - Add a two-user, one-workspace regression test with <code>getFilesystemBindings</code> enabled and <code>getExtraTools</code> absent.
   - Prove that the second user cannot observe the first user's company-context projection.

4. **Define and enforce revocation semantics for long-lived authority.**

   - Introduce an issuer/policy revocation epoch carried by verified claims or binding authority.
   - Re-check that epoch before publishing each stream event and before each capability operation.
   - Subscribe open connections and leases to membership/policy invalidation.
   - Abort or fence affected streams, callback leases, and in-flight operations on revocation.
   - Set explicit maximum lifetimes for SSE/event streams if continuous checking is too expensive.
   - Document the bound for already-started external side effects separately from response publication.
   - Test membership removal during session events, activity SSE, filesystem SSE, and dispatcher callbacks.

5. **Make the governance integration atomic.**

   - Replace the independently optional plugin/filter/metering/filesystem/Pi fields with one opaque governance integration bundle.
   - Have Core accept and validate that bundle as a unit.
   - Fail startup if governance routes/UI are installed without all required enforcement hooks.
   - Alternatively add a CI composition invariant for every production app, but prefer a type/runtime construction boundary.
   - Add deletion tests for each seam:
     omitting model admission,
     filesystem attenuation,
     metering,
     or strict model resolution must fail startup.

6. **Implement live, versioned governance-policy updates or explicitly retain restart-only semantics.**

   - Load a validated immutable policy generation atomically.
   - Keep the prior valid generation on parse failure while surfacing a stable diagnostic.
   - Increment a policy epoch on successful replacement.
   - Invalidate subject bindings and revoke affected leases/streams when the epoch changes.
   - If reload is intentionally deferred, expose the active generation and required-restart status operationally.
   - Do not describe file edits as immediate revocation until the invalidation path exists.

7. **Implement #1123 before claiming structural exec/mount enforcement.**

   - Add a typed exec-grant schema, including <code>environment.bash.execute</code>.
   - Resolve grants to a canonical mount set before Environment acquisition.
   - Have Host-owned code derive the canonical mount-set digest; do not trust an opaque caller string.
   - Include the canonical mount set in lease key and provider creation context.
   - Make inaccessible mounts physically absent from the sandbox namespace.
   - Gate bash-tool assembly on the exec grant.
   - Fail closed on providers that cannot realize requested mounts.
   - Retire old grant-derived leases and dispose zero-reference forked records within a stated bound.
   - Add cross-agent tests proving different mount sets cannot share an Environment.
   - Only after those proofs should the control be classified STRUCTURAL.

8. **Harden the AgentHost construction boundary.**

   - Stop exporting <code>EmbeddedAgentGateway</code> from the public server barrel.
   - Make its constructor module-private or require a factory-private runtime token.
   - Ensure test conformance helpers consume public <code>AgentGateway</code> contracts without exposing construction internals.
   - Upgrade the CI invariant from call-name heuristics to module-boundary/import-graph enforcement.
   - Add negative fixtures for renamed re-exports, wrappers, computed keys, dynamic imports, and production imports of test helpers.
   - Scan alternate constructors and factory equivalents, not only <code>createAgentHost</code> calls.
   - Preserve the current verified five composition roots as the explicit allowlist.

9. **Make runtime issuer guarantees explicit in the Host contract.**

   - Rename the type brand documentation to “compile-time anti-confusion marker.”
   - Specify a runtime issuer contract with object provenance and claim-integrity checks.
   - Decide whether generic <code>createAgentHost()</code> may accept arbitrary verifiers.
   - If not, require a factory-produced issuer/verifier pair or verify an unforgeable runtime token.
   - Keep current membership lookup app-owned, because only the app owns membership state.
   - Add a conformance suite covering plain objects, spreads, structured clones, mutations, cross-issuer scopes, and revoked scopes.

10. **Separate authored-data trust from trusted host configuration in all documentation and types.**

    - Preserve the strict authored AgentDefinition schema; it is a verified control.
    - Label fleet YAML, policy YAML, preflighted plugin artifacts, and deployment constants as trusted host configuration.
    - State clearly that trusted host configuration does select plugins, models, tools, and runtime contributions.
    - Retain digest/path confinement for skill instruction content.
    - Avoid saying “config never selects executable behavior” without the “authored AgentDefinition” qualifier.
    - Add an architecture test ensuring authored package fields cannot flow into <code>plugins</code>, <code>model</code>, <code>extraTools</code>, credentials, or extension paths.

11. **Fail closed for standalone and playground exposure.**

    - Require an auth token when standalone binds non-loopback.
    - Reject missing standalone auth when <code>NODE_ENV=production</code> unless an explicit, auditable unsafe flag is set.
    - Default <code>externalPlugins</code> to false outside an explicitly trusted-local authoring mode.
    - Keep the stock CLI loopback default.
    - Change the general dev server's unauthenticated <code>0.0.0.0</code> bind to loopback or require an explicit expose flag.
    - Exclude playground/dev entrypoints from production deployment artifacts where practical.
    - Add startup tests for production, loopback, non-loopback, token, and unsafe-override combinations.

12. **Make optional authorization callbacks explicit and safe.**

    - Require <code>authorizeRequest</code> in <code>skillsRoutes</code> for the normal exported API.
    - If unauthenticated registration is needed, expose a separately named trusted-local helper.
    - Apply the same review to other route modules whose authorization callback is optional.
    - Add route-level negative tests that register the normal API without authorization and expect startup failure.

13. **Retain and strengthen the controls that already hold.**

    - Keep Core's live workspace/user/membership verifier checks.
    - Keep per-command re-verification on open session connections.
    - Keep issuer-private WeakMap/WeakSet provenance in first-party hosts.
    - Keep full-app's complete governance wiring.
    - Keep strict authored schema rejection of behavior refs.
    - Keep full-app <code>externalPlugins: false</code>.
    - Keep production dev-login and unverified-email guards.
    - Keep readonly company-context projection and same-ID binding intersection.
    - Add conformance tests so these verified controls remain visible and do not regress while the broader claims are narrowed.

14. **Treat the production unsafe-mode override as an explicit exception, not an invariant.**

    - Decide whether <code>BORING_ALLOW_UNSAFE_AGENT_MODE</code> remains supported in production.
    - If retained, require an operator-visible startup warning and deployment audit event.
    - Make the risk explicit: it bypasses the default production confinement requirement.
    - Do not describe production sandbox mode as structurally mandatory while the override exists.

15. **Add one authorization proof matrix to CI.**

    - Rows: gateway method, connection command, event delivery, activity SSE, filesystem SSE, Environment operation, dispatcher callback, model execution, MCP invocation, bash/mount access.
    - Columns: issuer provenance, current membership, agent grant, policy generation, lease identity, revocation trigger, maximum persistence bound.
    - Require executable tests for each ENFORCED-BY-CODE cell.
    - Require an architectural assertion for each STRUCTURAL cell.
    - Require documentation to label every remaining cell CONVENTION-ONLY.
    - This matrix should prevent another policy/architecture mismatch from being described as a shipped differentiator.
