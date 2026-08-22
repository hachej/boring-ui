# Credential-management adversarial security review

## Executive verdict

- Review target: `origin/main`, inspected with `git show origin/main:<path>` and `git grep ... origin/main`.
- Decision 27 is accepted policy, but its production model-credential architecture is not implemented.
- The hosted Pi harness uses process-global environment credentials and the host Unix account's shared `~/.pi/agent/auth.json`.
- The resulting `AuthStorage`, `ModelRegistry`, and Pi `AgentSession` are cached beyond one invocation.
- This is a FATAL violation of the requested invocation-scoping invariant.
- The workspace BYOK row is never consulted on the live model call path.
- A missing, present, unreadable, corrupted, or wrong-key workspace setting has no effect on payer selection.
- Instance fallback is therefore not a controlled fallback; ambient Pi auth is the actual general fallback.
- Direct-mode model-controlled shell inherits the full service process environment and host `HOME`.
- Bwrap shell also inherits the full service process environment unless a caller supplies an explicit environment.
- Both expose provider keys, connector tokens, and `WORKSPACE_SETTINGS_ENCRYPTION_KEY` to `env`.
- Direct mode additionally makes `~/.pi/agent/auth.json` readable by the model-controlled shell.
- Runsc is materially safer: it gives commands four fixed non-secret environment variables and no network.
- Runsc credentials travel via fd 3, but an influenced credential-bearing command can print fd 3 into returned output.
- Generic tool results are returned to Pi without a framework-level secret scrub.
- Those results enter current model context, Pi's durable JSONL transcript, history APIs, and UI history.
- Per-agent MCP grants are correctly resolved in isolation but are not enforced by the executable connector path.
- Connector source ownership does prevent the direct workspace-A-to-workspace-B account attack inspected here.
- Connector result redaction is heuristic and misses common secret names and arbitrary opaque secret values.
- Existing `workspace_settings` storage is encrypted, but uses one process-wide passphrase for all workspaces.
- Its ciphertext is not bound to workspace or setting identity by application-supplied authenticated data.
- Wrong-key and tamper failures are collapsed to `null`/`configured:false`, contradicting fail-closed fallback semantics.
- The newer AES-256-GCM credential-vault and 60-second lease code has strong controls but is not composed in production.
- The strongest verified controls are membership on the settings HTTP route, metadata-only settings responses, secure file-secret ingestion, metadata-only telemetry, exact connector source ownership, and runsc invocation isolation.

## Severity model

- **FATAL**: reusable cross-tenant credential authority is captured, or a tenant can directly extract instance-wide secrets.
- **CRITICAL**: ordinary tenant activity silently uses unrelated payer authority or bypasses an intended authorization boundary.
- **HIGH**: realistic secret disclosure, authority-retention, billing, or cross-scope failure requiring a secondary condition.
- **MEDIUM**: bounded retention or error-path disclosure requiring a buggy/custom provider or operational timing.
- **LOW**: sensitive metadata retention without a demonstrated standalone bearer capability.

## IMPLEMENTATION BUG 1 — FATAL — Decision 27's invocation-scoped model capability does not exist on the live path

### Claim under test

- Decision 27 requires membership-before-resolution and distinct trusted Core/web and CLI `ModelCapabilityIssuer` adapters.
- It requires one opaque model client or capability per authorized invocation.
- It forbids a cached `AgentApplication` from capturing reusable credentials.
- Evidence: `docs/DECISIONS.md:438-445`.
- It also forbids ambient Pi auth files/OAuth as a hosted payer fallback.
- Evidence: `docs/DECISIONS.md:450-452`.

### Exact abuse path

1. An authenticated member starts or resumes a hosted chat session.
2. The harness creates Pi-owned auth without any workspace credential scope.
3. `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts:540-550` states that credentials are Pi-owned and calls `AuthStorage.create()`.
4. The same lines create `ModelRegistry.create(authStorage)` from ambient sources.
5. `createHarness.ts:551-557` resolves the requested/default model through that global registry.
6. `createHarness.ts:647-660` passes `authStorage` and `modelRegistry` into `createAgentSession`.
7. `createHarness.ts:668-679` stores the Pi session, registry, and session manager in `piSessions`.
8. `createHarness.ts:480-515` reuses that cached handle for later invocations of the same scoped session.
9. `createHarness.ts:690-707` disposes it only on session lifecycle events, not at invocation completion.
10. No implementation symbol named `ModelCapabilityIssuer` exists outside Decision 27.
11. No production code composes `createHostSideCredentialResolverV1` or the credential vault into model execution.
12. The long-lived Pi session therefore captures reusable ambient credential authority.

### Exploitability

- Attacker: any authorized tenant member who can submit a chat prompt.
- Required access: no filesystem, database, operator, or other-workspace access.
- Action: select or trigger any model marked available by Pi.
- Result: the request uses whichever credentials belong to the host process or host Unix account.
- Tenant A and tenant B share the same payer source.
- The attacker need not know the key to spend it.
- If ambient auth includes OAuth, the inherited authority may be broader than billing.

### Impact

- Cross-tenant payer confusion.
- Unmetered or incorrectly attributed instance spend.
- Use of a human operator's provider account by unrelated tenants.
- Revocation cannot be enforced at Boring's intended invocation boundary because that boundary is absent.
- This satisfies the review's explicit FATAL condition: reusable credential authority is captured by a cached application/session object.

### Fix

- Implement a hosted-only `ModelCapabilityIssuer` after current authentication and membership verification.
- Make the issued object opaque, nonserializable, and one-invocation-only.
- The cached Pi session may retain only an issuer function, never `AuthStorage`, a model client, token, or resolved key.
- Resolve provider authority immediately before each provider request.
- Dispose and render the capability unusable immediately after that request.
- Reject all ambient Pi environment/file/OAuth sources in hosted mode.
- Keep ambient Pi auth only in the explicitly trusted-local CLI adapter.
- Add concurrent tenant-A/tenant-B tests and queued-follow-up tests that assert payer separation.

## IMPLEMENTATION BUG 2 — CRITICAL — Instance fallback is uncontrolled ambient fallback

### Exact abuse path

1. Decision 27 permits a missing workspace key to fall back only to explicit instance `ANTHROPIC_API_KEY`.
2. A configured-but-unreadable workspace key must fail closed.
3. Evidence: `docs/DECISIONS.md:450-452`.
4. The live harness never calls `PostgresWorkspaceStore.decryptSetting`.
5. `createHarness.ts:546-557` always constructs Pi's normal auth sources and lets Pi own final fallback.
6. `packages/agent/src/server/http/routes/models.ts:4-7` documents environment plus `~/.pi/agent/auth.json` as auth sources.
7. `models.ts:66-70` creates a process registry from those sources.
8. `models.ts:76-92` derives model availability from that global registry.
9. A workspace may have no BYOK, a readable BYOK, or an unreadable BYOK; all three take the same live path.
10. Pi may resolve Anthropic, Google, OpenAI-compatible, or another ambient provider, not only the named Anthropic instance fallback.

### Constructed billing cases

- Tenant A has no BYOK and prompts Anthropic: the instance environment or Pi auth file pays silently.
- Tenant A stores a workspace key, but the settings encryption key is wrong: the model path ignores the failure and ambient auth still pays.
- Tenant A has an Anthropic BYOK, while the host has only `GEMINI_API_KEY`: static seat selection may choose Google and charge the host.
- Tenant B has a revoked workspace key: cached Pi auth can continue using unrelated host authority.

### Static payer-selection evidence

- `packages/agent/src/server/agentDefinition/loadConfiguredAgentFleet.ts:14-31` calls the tier behavior a host funding fallback.
- `loadConfiguredAgentFleet.ts:39-55` hardcodes process environment candidates including `ANTHROPIC_API_KEY` and `GEMINI_API_KEY`.
- `loadConfiguredAgentFleet.ts:251-259` selects the first candidate solely by process-env presence.
- Workspace BYOK is not considered in this decision.

### Exploitability

- Attacker: ordinary tenant with prompt access.
- Required condition: the host has any ambient provider credential or Pi login.
- No malicious input beyond requesting a model is necessary.
- Misrotation or corruption makes the forbidden fallback case especially likely.

### Fix

- Represent workspace credential state as exactly `ABSENT`, `READABLE`, or `UNREADABLE/REVOKED`.
- Permit instance fallback only for `ABSENT` and an explicit deployment policy.
- Permit only the named instance provider/key unless policy is deliberately expanded.
- Deny on `UNREADABLE`, corruption, wrong key, tombstone, disabled state, or backend outage.
- Static fleet policy may select a model class, but must not select payer authority from environment-key presence.

## IMPLEMENTATION BUG 3 — CRITICAL — Shared Pi auth file is a cross-tenant credential authority

### Exact abuse path

1. `packages/agent/src/server/http/routes/models.ts:4-7` explicitly names `~/.pi/agent/auth.json`.
2. `models.ts:66-70` builds and caches a registry from the process environment and that file.
3. `createHarness.ts:546-550` creates the same normal Pi auth source for real sessions.
4. `createHarness.ts:647-679` hands it to and caches the Pi session.
5. Nothing maps an auth-file entry to a web user or workspace.
6. Nothing verifies current membership at credential resolution.
7. Nothing prevents workspace A and workspace B from using the same entry.

### Whose credentials are they?

- They belong to whichever Unix account and home directory started the host process.
- In practice they may be an operator's prior `pi login` credentials.
- `packages/cli/src/server/cli.ts:126-140` intentionally tells a trusted-local CLI user that `/login` saves credentials there.
- That behavior is reasonable for local CLI.
- Reusing the same ambient pattern in hosted mode is the implementation defect.

### Exploitability

- Attacker: any tenant able to prompt a model.
- Direct mode additionally permits literal file theft with `cat ~/.pi/agent/auth.json`.
- Other modes still allow use of the authority without revealing its bytes.
- Knowledge of token format or provider is unnecessary because model discovery advertises availability.

### Rotation/revocation bound

- Boring establishes no per-call refresh or revocation hook for the auth file.
- The discovery registry is process-cached at `models.ts:66-70`.
- Real session handles retain `AuthStorage`/`ModelRegistry` until disposal at `createHarness.ts:668-707`.
- Exact upstream Pi SDK caching behavior is external, but Boring provides no enforceable upper bound.

### Fix

- Hosted mode must use an empty/isolated `HOME` and deny filesystem Pi auth.
- Supply an in-memory auth adapter only from the authorized invocation issuer.
- Make the models endpoint descriptive only; never use its global registry as authorization.
- Run trusted-local CLI and multi-tenant host under distinct configuration and OS identities as defense in depth.

## IMPLEMENTATION BUG 4 — FATAL — Direct shell exposes all service secrets and host credential files

### Code that builds the direct environment

- `packages/boring-sandbox/src/providers/direct/createDirectSandbox.ts:98-104` calls `spawn` with `shell:true`.
- Its `env` is `withWorkspacePythonEnv({ workspaceRoot, env: opts?.env, preserveHostHome: true })`.
- `packages/boring-sandbox/src/providers/node-workspace/workspacePythonEnv.ts:27-30` chooses `env ?? getEnvSnapshot()`.
- `workspacePythonEnv.ts:37-44` spreads the entire base environment, changing only runtime-related values.
- `packages/boring-sandbox/src/providers/runtimeSupport.ts:12-14` defines the snapshot as `{ ...process.env }`.
- `workspacePythonEnv.ts:35-40` preserves host `HOME` when requested.
- `packages/boring-bash/src/agent/tools/harness/bashToolOptions.ts:45-60` defaults direct spawn to `preserveHostHome=true`.
- `bashToolOptions.ts:76-85` uses that behavior for host strategy.

### Exact leak path

1. Tenant prompt or injected content persuades the model to invoke bash.
2. Bash runs `env` or reads `/proc/self/environ`.
3. The child inherited the entire service `process.env`.
4. Provider keys, connector tokens, database credentials, and `WORKSPACE_SETTINGS_ENCRYPTION_KEY` are visible.
5. The child retains host `HOME`.
6. It can read `~/.pi/agent/auth.json`, CLI config, cloud credentials, SSH files, or other service-readable host files.
7. Direct mode has no filesystem isolation and normally has host networking.
8. The attacker can return the values through tool output or exfiltrate them directly.

### Exploitability

- Attacker: any tenant whose agent can call bash, including through prompt injection.
- Required host condition: direct mode.
- No separate host access is required.
- A single successful command compromises instance-wide model, workspace-settings, and connector authority.

### Fix

- Prohibit direct mode in any multi-tenant or BYOK deployment at startup.
- Construct child environment from an explicit allowlist: fixed `PATH`, `LANG`, isolated `HOME`, workspace root, and required runtime paths only.
- Never snapshot `process.env` for a model-controlled child.
- Never mount or preserve the host home.
- Keep all provider and connector credentials behind trusted call adapters.
- Add canary tests for arbitrary `*_TOKEN`, `*_SECRET`, `*_KEY`, and the workspace settings key.

## IMPLEMENTATION BUG 5 — CRITICAL — Bwrap isolation inherits the full service environment

### Code that builds the bwrap environment

- `packages/boring-sandbox/src/providers/bwrap/createBwrapSandbox.ts:274-292` builds arguments and spawns `bwrap`.
- At `:285-289`, the spawn environment comes from `withWorkspacePythonEnv` plus `PWD`.
- When `opts.env` is absent, `workspacePythonEnv.ts:27-44` copies all of `process.env`.
- `packages/boring-sandbox/src/providers/bwrap/buildBwrapArgs.ts:87-101` unshares namespaces but does not add `--clearenv`.
- `buildBwrapArgs.ts:121-124` only forces `HOME=/workspace`.
- Environment variables are not isolated by Linux namespaces.

### Exact leak path

1. Model-controlled bash runs inside bwrap.
2. It executes `env`.
3. `ANTHROPIC_API_KEY`, other provider keys, connector tokens, and the settings encryption key remain present.
4. `buildBwrapArgs.ts:90-96` defaults to shared networking through `--share-net`.
5. The attacker can exfiltrate the values over the network.

### Additional exposure

- `buildBwrapArgs.ts:9-18` includes broad read-only binds such as all of `/etc`.
- `buildBwrapArgs.ts:103-105` applies those binds.
- Any service-readable secrets under those paths may become visible inside the sandbox.

### Exploitability

- Attacker: any tenant able to drive bash in local/bwrap mode.
- No filesystem escape is needed; `env` alone is sufficient.
- Bwrap's filesystem isolation may create false confidence while leaving the highest-value secrets exposed.

### Fix

- Add unconditional `--clearenv`.
- Spawn bwrap itself with a safe explicit allowlist.
- Add back only fixed non-secret variables through `--setenv`.
- Default network to isolated and broker only approved outbound calls.
- Replace broad `/etc` bind with exact CA, resolver, and runtime files.

## VERIFIED CONTROL 1 — Runsc command environment is clean and fixed

### Evidence

- `packages/boring-sandbox/src/providers/runsc/runtime/dockerArgv.ts:65-112` builds container creation without tenant secret environment flags.
- The same path uses `--network none` at `dockerArgv.ts:95-96`.
- `packages/boring-sandbox/src/providers/runsc/runtime/workload/cmd/boring-runtime/supervisor.go:148-159` constructs the tenant process.
- The exact environment is:
  - `HOME=/workspace`
  - `LANG=C.UTF-8`
  - fixed system `PATH`
  - `TMPDIR=/tmp`
- It does not inherit the supervisor or host environment.
- `packages/boring-sandbox/src/shared/remoteWorkerProtocolV1.ts:326-341` has no arbitrary general environment field.

### Verdict

- An agent running plain `env` inside runsc cannot see provider keys, connector tokens, or `WORKSPACE_SETTINGS_ENCRYPTION_KEY`.
- Network isolation blocks ordinary direct exfiltration.
- This portion of Decision 27's no-general-shell-environment claim holds.

## IMPLEMENTATION BUG 6 — HIGH — Runsc fd-3 credentials can be printed into model-visible output

### Exact leak path

1. A trusted host resolver approves a credential-bearing runsc invocation.
2. `packages/boring-sandbox/src/providers/runsc/runtime/invocationEnvelope.ts:55-104` encodes resolved fields into a credential frame.
3. `invocationEnvelope.ts:107-127` embeds that credential frame in the invocation envelope.
4. `supervisor.go:160-194` creates a pipe and hands it to the child as fd 3.
5. An influenced command runs `cat <&3`, dumping the binary frame.
6. A command can also use the runtime credential helper to print a named field.
7. `supervisor.go:148-159` captures arbitrary stdout and stderr.
8. `supervisor.go:244-250` base64-encodes and returns that output.
9. `packages/boring-sandbox/src/providers/runsc/runtime/sessionRuntime.ts:583-653` decodes and returns it without secret-aware scrubbing.
10. The generic tool adapter then sends it to Pi.

### Exploitability

- Attacker must influence a credential-bearing command.
- Plausible routes include a compromised plugin, command injection, malicious MCP server, or confused consumer binding.
- No external network is needed because returned stdout crosses back to the host/model.
- Plain general bash without a credential reference cannot access fd-3 material.

### Fix

- Credential-bearing runsc invocations must execute a fixed trusted entrypoint/argv, not arbitrary shell.
- Give fd 3 only to that specific consumer process.
- Return a typed result schema that excludes arbitrary stdout/stderr.
- Treat any unexpected output from a secret-bearing invocation as terminal and non-displayable.
- Never attach raw secret-bearing output to `ToolResult`.

## VERIFIED CONTROL 2 — Runsc invocation scoping and cleanup are strong

### Evidence

- `packages/boring-sandbox/src/providers/runsc/runtime/invocationCredentials.ts:159-179` rejects LLM providers.
- It requires an allowed untrusted consumer, `sandbox-pipe` delivery, and fd 3.
- `invocationCredentials.ts:180-190` checks requested fields against binding authorization.
- `invocationCredentials.ts:193-210` binds workspace, sandbox, execution, and delivery attempt.
- `invocationCredentials.ts:211-227` validates payload scope, credential version, and expiry.
- `invocationCredentials.ts:229-278` validates exact field set and size bounds.
- `sessionRuntime.ts:460-481` fails closed if scope or resolver is missing.
- `sessionRuntime.ts:322-335` checks workspace binding before execution.
- `sessionRuntime.ts:345-361` makes secret-bearing invocations non-replayable.
- `sessionRuntime.ts:405-429` replaces the container before and after a secret-bearing invocation.
- `sessionRuntime.ts:430-457` and `:484-512` replace or retire after uncertain failure.
- `sessionRuntime.ts:445-453` zeroes envelope bytes and disposes payload leases in `finally`.

### Verdict

- These controls materially constrain replay, cross-workspace delivery, lingering tenant processes, and missing-authority behavior.
- They do not solve raw output disclosure or mid-invocation revocation.

## IMPLEMENTATION BUG 7 — CRITICAL — Raw tool output reaches model context and durable transcript

### Exact leak path

1. A tool prints a secret through `env`, `curl -v`, config-file read, MCP output, or an error.
2. `packages/agent/src/server/harness/pi-coding-agent/tool-adapter.ts:53-70` invokes the tool.
3. `tool-adapter.ts:81-91` returns `result.content` and `result.details` verbatim on success and declared error.
4. `tool-adapter.ts:92-100` rethrows raw unexpected errors.
5. Pi receives the tool result as current conversation context.
6. `createHarness.ts:576-588` opens the native Pi transcript with `SessionManager`.
7. `createHarness.ts:647-660` passes that manager to `createAgentSession`.
8. The native Pi JSONL transcript therefore persists the tool result.
9. `packages/agent/src/server/harness/pi-coding-agent/sessions.ts:303-313` reloads persisted message objects.
10. `sessions.ts:401-404` returns the persisted messages without a secret scrub.
11. `packages/agent/src/server/pi-chat/piChatHistory.ts:171-205` copies tool-result content/details into history.
12. The secret reaches live context, durable transcript, UI history, and any transcript consumer.

### Exploitability

- Attacker: prompt injection, malicious workspace file, compromised connector, buggy tool, or ordinary user asking for `env`.
- No token-format knowledge is required.
- Transformations such as base64, hex, URL encoding, chunking, or character splitting evade exact-value replacement.

### Existing partial controls

- `tool-adapter.ts:24-43` builds metadata-only telemetry properties.
- `tool-adapter.ts:71-80` and `:93-97` record tool name, session, status, duration, and stable error code only.
- `tool-adapter.telemetry.test.ts:205-249` verifies secret output stays out of telemetry while remaining in returned result.
- This is a good telemetry control and simultaneously proves the context/transcript leak remains.

### Fix

- Remove credentials from general tool-visible environments and files first.
- Add one mandatory trusted result policy before any `ToolResult` enters Pi.
- Apply it before streaming updates, model context, transcript append, UI events, errors, and logs.
- Secret-bearing consumers should return typed safe projections, not arbitrary stdout.
- Quarantine rather than log rejected raw values.
- Scan and migrate existing durable transcripts because prevention does not remove already persisted secrets.

## DESIGN GAP 1 — HIGH — Bash redaction is partial, local, and bypassable

### Evidence

- `packages/agent/src/server/runtimeEnvContributions.ts:23-37` combines runtime environment contributions.
- `runtimeEnvContributions.ts:39-49` injects them into sandbox execution and exposes `getRuntimeEnv`.
- `packages/boring-bash/src/agent/tools/harness/index.ts:28-32` classifies only selected secret-like variable names.
- `harness/index.ts:97-108` obtains contributed runtime env for a bash call.
- `harness/index.ts:109-131` suppresses streaming when it detects those contributed secrets.
- `harness/index.ts:134-165` replaces exact detected plaintext in final text/errors/details and deletes Pi's spill file.

### What it misses

- Host-inherited `process.env` secrets in direct/bwrap.
- fd-3 runsc credential material.
- Workspace file contents such as `.env` or copied credentials.
- Connector provider results.
- Secret aliases that do not match its name pattern.
- Encoded, transformed, fragmented, hashed, compressed, or partially printed secrets.
- Non-bash tools, including isolated-code output paths.

### Verdict

- The control reduces accidental plain-text echo of known contributed values.
- It is not a security boundary and cannot substantiate Decision 27's broad never-written/never-reaches-model claim.

### Fix

- Use typed taint metadata from credential resolution through the consuming operation.
- Deny arbitrary output for secret-bearing operations.
- Apply a central context/transcript policy to every tool, not bash-only filtering.

## IMPLEMENTATION BUG 8 — HIGH — Wrong-key/tamper errors collapse into “absent”

### Exact fail-open path

1. `packages/core/src/server/db/stores/PostgresWorkspaceStore.ts:774-793` queries `pgp_sym_decrypt`.
2. `PostgresWorkspaceStore.ts:794-798` catches every error and returns `null`.
3. `PostgresWorkspaceStore.ts:818-838` converts `null` to `configured:false`.
4. `workspaceSettingsCrypto.test.ts:147-162` locks in wrong-key decrypt as `null` and `configured:false`.
5. Any future fallback code using this API cannot distinguish no row from unreadable ciphertext.
6. It will silently choose instance fallback in exactly the case Decision 27 says must fail closed.

### Exploitability

- Operator misrotation alone triggers the condition.
- A database-write attacker can corrupt ciphertext.
- Storage damage or a bad migration can do the same accidentally.
- An ordinary tenant does not need to cause it for billing confusion to occur.

### Fix

- Return a discriminated result: `ABSENT`, `READABLE`, `UNREADABLE`.
- Define `ABSENT` only as no row found.
- Propagate authentication/decrypt/config/backend failure as a stable fail-closed error.
- Add tests that assert unreadable state suppresses instance fallback.

## DESIGN + IMPLEMENTATION BUG 9 — HIGH — One weakly validated passphrase spans every workspace

### Encryption code

- `PostgresWorkspaceStore.ts:150-154` stores one process-wide `workspaceSettingsKey`.
- `PostgresWorkspaceStore.ts:782` decrypts with ciphertext and that one key.
- `PostgresWorkspaceStore.ts:810-815` encrypts with plaintext and the same key.
- `packages/core/src/server/config/schema.ts:80-82` accepts any nonempty string.

### Security properties

- `pgp_sym_encrypt` provides encrypted OpenPGP data and packet integrity.
- The application supplies no workspace-specific key and no workspace/setting authenticated data.
- The same passphrase decrypts rows for every tenant.
- A one-character passphrase is configuration-valid despite operator documentation recommending 32-byte hex.
- A database dump therefore exposes all tenants to the same offline passphrase-guessing event.

### Row-swap attack

1. A database-write attacker copies workspace B's ciphertext into workspace A's `(workspace_id,key)` row.
2. Decryption uses only ciphertext plus the same global passphrase.
3. Workspace A can receive workspace B's plaintext if the consumer asks for that key.
4. No application AAD binds ciphertext to `workspaceId` or setting key.

### Exploitability

- Requires database write or a sufficiently dangerous migration/restore error.
- Database read alone enables offline guessing against all workspaces.
- This is not an ordinary member-to-member route exploit.

### Fix

- Use random per-workspace DEKs.
- Wrap DEKs with versioned KMS/KEK authority.
- Encrypt fields with AES-256-GCM or equivalent AEAD.
- Canonically bind workspace, credential, provider, field, credential version, and DEK generation as AAD.
- Enforce 32 random bytes for local KEK material.

## DESIGN GAP 2 — HIGH — Existing settings-key rotation and revocation lifecycle is absent

### Evidence

- `packages/core/src/server/config/loadConfig.ts:202` resolves file secrets at startup.
- `loadConfig.ts:217-223` selects one settings key from file or environment.
- `loadConfig.ts:313-315` projects that one value into configuration.
- `createCoreWorkspaceAgentServer.ts:957-960` captures it in the store.
- `packages/core/src/server/app/types.ts:77-78` exposes only get/put settings.
- `PostgresWorkspaceStore.ts:841-849` only overwrites values.
- There is no key ID, keyring, dual-read period, re-encryption migration, delete, revoke, or tombstone method.

### Rotation behavior

- Replacing the key makes every existing row unreadable.
- Because unreadable becomes `configured:false`, a future fallback can silently charge the instance.
- There is no safe rewrap or staged rollout.
- Revoking one workspace credential requires overwriting it with another nonempty value; absence/revocation is not represented.

### Fix

- Store key reference and version with ciphertext.
- Support dual-read/one-write rotation and audited rewrap.
- Add explicit disabled/revoked tombstones.
- Add owner-only rotate/revoke operations with concurrency/version checks.

## DESIGN GAP 3 — HIGH — Workspace deletion does not revoke or destroy credentials

### Evidence

- `PostgresWorkspaceStore.ts:270-285` soft-deletes a workspace by setting `deletedAt`.
- `packages/core/src/server/db/schema.ts:111-123` gives `workspace_settings` a foreign key with `onDelete:'no action'`.
- The workspace store interface has no settings deletion or credential revocation operation.

### Consequence

- Ciphertext remains decryptable indefinitely under the global key.
- Restore can silently revive old credential authority.
- Upstream provider credentials remain live because workspace deletion does not revoke them.
- Database backups preserve the ciphertext until independent retention expiry.

### Exploitability

- Ordinary members cannot use guarded routes after soft deletion.
- Risk arises from restore, operator access, backups, or later authorization mistakes.
- The credential outlives the workspace's intended authority.

### Fix

- Deletion must write a credential revocation tombstone and attempt upstream revocation.
- Cryptoshred the workspace DEK or delete credential rows after the retention window.
- Restore must require explicit credential reconnection.

## IMPLEMENTATION BUG 10 — HIGH — Generic settings endpoint grants editors future payer-control authority

### Evidence

- `packages/core/src/server/routes/settings.ts:10-16` protects metadata GET with membership.
- `settings.ts:20-35` permits PUT for `editor` and above.
- `packages/core/src/server/routes/__schemas__/settings.ts:3-8` accepts arbitrary nonempty key names and values.
- There is no reserved credential namespace, owner-only credential route, deletion, rotation, or audit contract.

### Exploitability

- Any workspace editor can overwrite a credential-like setting.
- Once a model resolver consumes a known setting key, an editor can choose or replace payer authority.
- This creates billing and confused-deputy risk even if plaintext is never returned.

### Fix

- Reject reserved credential names in generic settings PUT.
- Add a dedicated owner-only, write-only credential endpoint.
- Return masked metadata only.
- Require credential version, idempotency/concurrency control, rotate, disable, and revoke semantics.

## VERIFIED CONTROL 3 — Settings HTTP membership checks hold

### Evidence

- `settings.ts:10-16` invokes `requireWorkspaceMember()` before metadata reads.
- `settings.ts:20-35` invokes `requireWorkspaceMember('editor')` before writes.
- `packages/core/src/server/auth/requireWorkspaceMember.ts:17-32` requires an authenticated request and checks request-scoped workspace authorization.
- `requireWorkspaceMember.ts:43-65` validates workspace/app and membership.
- `requireWorkspaceMember.ts:67-73` enforces minimum role.

### Verdict

- Membership-before-storage-read/write holds for the existing settings routes.
- It does not prove membership-before-model-credential-resolution because the model path never resolves workspace settings.

## VERIFIED CONTROL 4 — Settings responses are metadata-only

### Evidence

- `PostgresWorkspaceStore.ts:818-838` returns key, configured flag, and update time only.
- `settings.ts:14-16` returns that metadata.
- Workspace settings crypto tests assert plaintext value is absent from responses and raw bytea lacks the plaintext canary.

### Caveats

- All members can see setting names.
- Arbitrary setting names are permitted, so callers must never put secret material in a key name.
- `configured` is currently unreliable because unreadable is mapped to false.

## VERIFIED CONTROL 5 — Settings-key file ingestion is hardened

### Evidence

- `packages/core/src/server/config/fileSecrets.ts:37-52` requires an absolute normalized path with no controls.
- It opens with `O_NOFOLLOW` and checks regular file, one link, current owner, exact mode `0400`, and bounded size.
- `fileSecrets.ts:78-86` forbids setting both env and file variants.
- `packages/core/src/server/config/schema.ts:80-82` rejects an empty settings key at production startup.
- `PostgresWorkspaceStore.ts:807-809` separately refuses encrypted writes without a key.

### Verdict

- File-supply controls are good.
- They do not enforce cryptographic key strength or rotation.
- Environment supply remains supported and may be exposed by the direct/bwrap bugs.

## VERIFIED CONTROL 6 — Storage and telemetry avoid routine plaintext logging

### Evidence

- `packages/core/src/server/db/connection.ts:12-19` enables no application query logger/debug hook.
- `packages/core/src/server/app/createCoreApp.ts:199-213` logs request metadata/headers, not request bodies.
- Its header redaction keys are defined at `createCoreApp.ts:15-22`.
- `PostgresWorkspaceStore.ts:794-797` logs only setting key, workspace ID, and error constructor on decrypt failure.
- `packages/core/src/server/telemetry/db.ts:98-175` allowlists property keys and formats.
- `packages/core/src/server/telemetry/posthog.ts:87-142` similarly allowlists and sanitizes.
- `tool-adapter.ts:24-43` emits metadata-only tool telemetry.

### Caveats

- Database/server statement logging is deployment-controlled and outside this repository.
- Custom telemetry sinks can violate assumptions if they ignore the safe event shape.
- Arbitrary errors and tool results still reach Pi/context/transcripts through other paths.

## VERIFIED BUT UNINTEGRATED CONTROL — Credential vault cryptography and leases are strong scaffolding

### Evidence

- `packages/agent/src/server/credentials/vault/envelopeCrypto.ts:20-32` specifies AES-256-GCM.
- It uses random 12-byte nonces and 16-byte authentication tags.
- It binds workspace, credential, provider, field, credential version, and DEK generation in canonical AAD.
- `envelopeCrypto.ts:128-152` performs authenticated encryption.
- `envelopeCrypto.ts:155-204` recomputes AAD and fails authentication closed.
- `packages/agent/src/server/credentials/hostResolver.ts:294-310` verifies current authority before backend reads.
- `hostResolver.ts:335-364` validates provider/binding and host-only delivery.
- `hostResolver.ts:368-408` reads only `authority.workspaceId`, sanitizes backend errors, and rechecks expiry.
- `hostResolver.ts:52` sets a 60-second host credential lease maximum.
- `hostResolver.ts:240-291` expires, zeroes, disposes, and forbids serialization.
- `packages/agent/src/server/credentials/withResolvedCredential.ts:8-19` disposes in `finally`.

### Why it cannot be credited to Decision 27 runtime

- No production composition uses this resolver for model calls.
- Persistence is currently an in-memory/reference seam rather than live hosted credential persistence.
- The real harness uses ambient Pi `AuthStorage`.
- These are verified component controls, not operational controls.

### Fix

- Complete production persistence and composition.
- Adapt the lease into the model issuer without ever exposing material to Pi sessions or general tools.
- Preserve the strong AAD, expiry, zeroization, and stable-error properties.

## IMPLEMENTATION BUG 11 — CRITICAL/FATAL — Per-agent MCP grants are not enforced at execution

### Correct but disconnected grant logic

- `packages/agent/src/server/agent-host/mcpGrants.ts:109-117` filters grants by exact workspace and agent.
- `mcpGrants.ts:120-164` drops ungranted refs, unknown connectors, and non-catalog tools.
- `packages/agent/src/server/agent-host/runtimeCapabilityProjection.ts:255-270` resolves grants using `claim.workspaceScopeId`.
- `runtimeCapabilityProjection.ts:272-297` returns tools and `mcpGrants` as separate fields.
- `runtimeCapabilityProjection.ts:310-325` uses grants for descriptive metadata.
- No production execution code consumes `binding.mcpGrants`.
- No production call site wires `createWorkspaceRuntimeResourceMcpGrantStore` into the executable path.

### Actual execution path

1. `apps/full-app/src/server/main.ts:56-58` supplies `getExtraTools` for every authorized request.
2. `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:1383-1404` appends those tools to the runtime.
3. `plugins/boring-mcp/src/server/appServerBinding.ts:471-478` creates request-scoped MCP tools.
4. `appServerBinding.ts:452-468` creates the full bridge tool set for the actor.
5. `plugins/boring-mcp/src/server/agentTools.ts:27-38` registers and executes all seven bridge tools.
6. `plugins/boring-mcp/src/server/readonlyCall.ts:183-212` checks source ownership and provider-wide readonly allowlist.
7. It never checks `agentTypeId`, `mcpServerRefs`, connector grant, or `grant.allowedTools`.

### Exploitability

- Attacker: any authenticated member whose runtime gets full-app MCP extra tools.
- The agent can use connected sources even if it declares no MCP refs.
- No grant, an empty grant, a wrong-agent grant, or a deleted grant all have no execution effect.
- This is a cross-agent authority bypass within the authenticated user/workspace.
- Grant revocation has no time bound because it has no effect at all.

### Fix

- Make an invocation-scoped resolved MCP grant capability mandatory at tool construction and call.
- Bind it to workspace, agent type, user/actor, connector, exact tool, and invocation.
- Enforce it at list, search, describe, and call boundaries.
- Remove unconditional full bridge installation.
- Test actual calls for missing, empty, deleted, wrong-workspace, and wrong-agent grants.

## VERIFIED CONTROL 7 — Direct workspace-A to workspace-B connector use was not found

### Evidence

- `plugins/boring-mcp/src/server/appServerBinding.ts:481-499` authenticates and checks workspace membership before returning an actor.
- `appServerBinding.ts:585-598` rejects conflicting presented workspace IDs under trusted scope.
- `createCoreWorkspaceAgentServer.ts:1334-1353` derives the authorized workspace/user context.
- `createCoreWorkspaceAgentServer.ts:1383-1390` passes that trusted context into extra-tool construction.
- `appServerBinding.ts:452-478` fixes the actor at tool construction.
- `plugins/boring-mcp/src/server/agentTools.ts:35-37` resolves that fixed actor rather than model-supplied identity.
- `plugins/boring-mcp/src/server/sourceAccess.ts:20-27` requires exact workspace and user source ownership.
- It masks mismatches as source-not-found.
- `appServerBinding.ts:394-434` reads sources from the actor-bound user settings scope.
- `plugins/boring-mcp/src/server/composioManagedConnector.ts:57-63` namespaces Composio user identity as `workspaceId:userId`.
- `composioManagedConnector.ts:215-237` rechecks account identity and toolkit.

### Verdict

- No direct path was found for workspace A to execute against workspace B's stored connected account.
- The live bug is missing per-agent/allowed-tool enforcement, not a demonstrated cross-workspace actor swap.

## DESIGN/IMPLEMENTATION GAP 4 — HIGH — MCP secret-result scrubbing is heuristic

### Exact leak path

1. Provider returns arbitrary content at `plugins/boring-mcp/src/server/readonlyCall.ts:210-213`.
2. `readonlyCall.ts:226-233` redacts and checks it with shared regex logic.
3. `plugins/boring-mcp/src/server/agentBridge.ts:201-205` repeats the same heuristic public-payload guard.
4. `plugins/boring-mcp/src/server/agentTools.ts:23-24` JSON-serializes the accepted value.
5. `agentTools.ts:35-38` returns it as a tool result.
6. The generic adapter sends it to Pi and the transcript.

### Redaction limitations

- `plugins/boring-mcp/src/shared/index.ts:581-595` recognizes selected key names and value syntaxes.
- It omits common keys such as `password`, `private_key`, and generic `token`.
- It misses arbitrary opaque values, bare API keys, AWS-style values, GitHub tokens, and encoded variants.
- `{ "password": "hunter2" }` can pass.
- `{ "token": "random-opaque-credential" }` can pass.
- A bare reflected `COMPOSIO_API_KEY` can pass if its format does not match the limited value regex.

### Partial control

- `plugins/boring-mcp/src/server/managedConnectorAdapter.ts:165-186` uses the resolved connector key as an exact canary for connect results.
- `managedConnectorAdapter.ts:193-224` does the same for refresh/probe.
- That exact canary is not propagated into readonly tool-result validation.

### Exploitability

- A compromised/buggy provider can reflect the connector key.
- A connected data source can return stored credentials under innocuous keys.
- The user only needs permission to invoke the readonly MCP tool.

### Fix

- Carry exact resolved-secret canaries or taint metadata through transport, error, and result validation.
- Prefer strict output schemas and safe projections.
- Quarantine suspect payloads without logging them.
- Acknowledge that arbitrary connected-account content cannot be reliably classified as secret by regex.

## DESIGN GAP 5 — HIGH — One Composio key is over-shared across every tenant

### Evidence

- `plugins/boring-mcp/src/server/appServerBinding.ts:51` names process-wide `COMPOSIO_API_KEY`.
- `appServerBinding.ts:81-90` loads it from server environment.
- `appServerBinding.ts:120-136` resolves the same environment secret for supported connectors.
- `appServerBinding.ts:443-449` uses that resolver for app agent tools.
- `plugins/boring-mcp/src/server/composioManagedConnector.ts:159-179` attaches it as `x-api-key` to control-plane calls.
- `composioManagedConnector.ts:240-248` attaches it to MCP session transport.

### Impact and exploitability

- One raw credential authorizes the provider project spanning unrelated tenants/accounts.
- A process compromise or successful reflection has instance-wide blast radius.
- Ordinary actor namespacing reduces accidental cross-account calls but does not attenuate the key itself.

### Fix

- Use workspace-scoped vault handles where the provider supports them.
- Exchange the long-lived control-plane key for narrow short-lived session tokens.
- Keep the master key in a separate broker, not the general application process.

## IMPLEMENTATION GAP 12 — MEDIUM — Connector rotation and in-flight revocation are bounded poorly

### Evidence

- `plugins/boring-mcp/src/server/composioManagedConnector.ts:438-466` caches raw `{secret, session}`.
- `composioManagedConnector.ts:469-486` reuses it until a five-minute expiry.
- Expired entries are pruned only on a later call.
- There is no immediate invalidation hook for secret rotation or disconnect.
- `plugins/boring-mcp/src/server/hardening.ts:70-85` implements timeout with `Promise.race` without aborting the underlying provider operation.

### Consequence

- A rotated key may remain usable for up to five minutes.
- Raw expired material can remain in heap indefinitely if no later call prunes it.
- A timed-out or disconnected in-flight remote call can continue.
- Later calls do re-read source state and require connected status at `readonlyCall.ts:194-195`.

### Fix

- Version secrets and cache keys by version.
- Invalidate immediately on rotate/disconnect.
- Plumb `AbortSignal` through SDK and fetch layers.
- Use short-lived provider sessions and document maximum post-revocation use.

## IMPLEMENTATION GAP 13 — MEDIUM — MCP HTTP error messages can expose custom-provider secrets

### Evidence

- `plugins/boring-mcp/src/server/appServerBinding.ts:235-243` copies `McpError.message` into a public HTTP error.
- `appServerBinding.ts:551-555` permits custom provider/transport wiring.
- A custom/future provider can include a secret in the message.
- Built-in Composio generally uses fixed messages and redacted details at `composioManagedConnector.ts:65-67,177-179`.

### Exploitability

- Requires a buggy, compromised, or custom provider error.
- An authenticated caller can trigger the route and receive the message.

### Fix

- Map public messages from stable error codes only.
- Never forward provider text to HTTP or tool output.
- Log fixed structured metadata with secret canaries.

## DESIGN GAP 6 — LOW — Connector authority references persist as plaintext metadata

### Evidence

- `plugins/boring-mcp/src/server/appServerBinding.ts:247-274` rehydrates full connector references.
- `appServerBinding.ts:351-390` persists full source objects in server-owned user settings.
- `plugins/boring-mcp/src/shared/index.ts:122-135,248-261` excludes connector refs from browser DTOs.
- `packages/core/src/server/app/routes.ts:20-42,119-154` protects server-owned settings from client overwrite/read.

### Verdict

- Current session/account references are not demonstrated standalone bearer tokens.
- They are sensitive correlation/authority metadata and should be minimized, expired, and encrypted if provider semantics make them reusable.

## DESIGN GAP 7 — HIGH — Revocation is checked only at invocation start

### Runsc bound

- `invocationCredentials.ts:211-227` checks expiry during credential resolution.
- No revocation subscription or recheck occurs after fd-3 delivery.
- Runsc maximum invocation timeout is approximately 15 minutes under runtime limits.
- `sessionRuntime.ts:445-453` disposes leases after invocation completion.
- A revoked credential can therefore remain available to the already-running child for the invocation duration.

### Direct-mode unbounded case

- `packages/boring-sandbox/src/providers/direct/createDirectSandbox.ts:126-157` resolves normally on child close.
- It kills process groups on timeout/abort at `:160-188`.
- It does not prove descendant cleanup after normal completion.
- A daemonized process that closes stdio can retain inherited credentials beyond the tool/session.

### Fix

- Use short-lived derived tokens rather than long-lived provider keys.
- Actively cancel credential-bearing invocations on revocation.
- Reduce maximum credential-bearing execution time.
- Broker outbound calls with authorization checks per call.
- Never permit multi-tenant direct mode.

## Decision 27 claim matrix

| Decision 27 claim | Verdict | Evidence summary |
|---|---|---|
| Per-workspace encrypted custody | Partial/dead for model BYOK | Generic settings are encrypted; model path never reads them. |
| Membership before web credential resolution | Storage route only | Settings routes check membership; live model resolution uses ambient Pi auth. |
| Invocation-scoped opaque model capability | **False / FATAL** | Cached Pi session retains ambient `AuthStorage`/registry. |
| Cached application never captures reusable credentials | **False / FATAL** | `piSessions` caches the credential-bearing Pi session. |
| Explicit instance-key fallback only | **False** | Pi environment/auth-file fallback is general and provider-ambient. |
| Unreadable BYOK fails closed | **False** | Storage maps decrypt failure to absent; model path ignores storage entirely. |
| No ambient hosted Pi auth fallback | **False** | Harness explicitly calls normal `AuthStorage.create()`. |
| No key in general shell environment | **False for direct/bwrap** | Both can inherit full service `process.env`. |
| No key in runsc `env` | **Verified** | Fixed four-variable environment; secrets delivered on fd 3. |
| No key in filesystems | **False in direct** | Host `HOME` and `~/.pi/agent/auth.json` are readable. |
| No key in session/transcript | **Unverified/false for printed secrets** | Generic tool output is persisted without central scrub. |
| No key in telemetry | Largely verified | Default tool/core telemetry is metadata-only and allowlisted. |
| No key in logs | Partial | Routine storage/request logs avoid bodies; arbitrary errors/tool paths remain unsafe. |
| Ciphertext fail-closed/authenticated to scope | **False for workspace_settings** | Global passphrase; no application AAD; errors collapse to null. |
| Rotation/revocation bounded | **False/partial** | Dead 60s vault lease; live Pi/session authority has no Boring bound. |
| Connector grants constrain execution | **False** | Grants are metadata-only; full bridge tools execute independently. |
| Cross-workspace connector account isolation | Verified for inspected path | Actor and source require exact workspace and user. |

## Priority remediation order

1. Disable multi-tenant direct mode and remove inherited environment from direct and bwrap immediately.
2. Disable ambient Pi auth/environment/file resolution in hosted mode.
3. Implement and compose the per-invocation `ModelCapabilityIssuer` before accepting hosted traffic.
4. Add a single mandatory tool-result/context/transcript secret policy.
5. Wire MCP grants into actual list/describe/call execution and remove unconditional bridge tools.
6. Replace fallback logic with explicit absent/readable/unreadable states.
7. Migrate BYOK from global-passphrase `workspace_settings` to the existing AEAD envelope-vault design.
8. Add owner-only credential rotate/revoke/delete/tombstone APIs and upstream revocation.
9. Restrict secret-bearing runsc execution to fixed trusted consumers and typed output.
10. Add active cache invalidation and cancellation for connector/model authority.

## Required adversarial regression proofs

- Seed `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `COMPOSIO_API_KEY`, and `WORKSPACE_SETTINGS_ENCRYPTION_KEY` in the host.
- Assert direct mode is refused in multi-tenant configuration.
- Assert bwrap `env` and `/proc/self/environ` contain none of the canaries.
- Assert isolated `HOME` cannot resolve `~/.pi/agent/auth.json`.
- Create tenant A and B with distinct BYOK keys and prove simultaneous calls use only their own payer.
- Make A's ciphertext unreadable and prove no instance or ambient fallback fires.
- Delete/revoke A's key and prove cached/queued follow-ups cannot use it.
- Prove cached AgentSessions retain no credential/client object, only an issuer seam.
- Print a seeded secret from bash, isolated code, MCP result, stderr, and thrown error.
- Assert it appears nowhere in live stream, model context, JSONL transcript, history API, UI event, logs, or telemetry.
- Print base64, hex, URL-encoded, chunked, and split variants and verify secret-bearing operations are quarantined rather than regex-scrubbed.
- Request MCP call with no grant, empty grant, wrong-agent grant, wrong-workspace grant, and deleted grant; assert no provider call occurs.
- Rotate/disconnect a connector during a call and prove transport cancellation and cache invalidation.
- Copy ciphertext between workspace rows and assert AEAD authentication failure after migration.
- Rotate the KEK with dual-read/rewrap and prove uninterrupted correct reads without fallback.
- Soft-delete and restore a workspace and prove credentials remain revoked until explicit reconnection.
