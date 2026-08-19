<table>
<thead>
<tr>
<th>Capability</th>
<th>Which framework has it</th>
<th>What it does</th>
<th>Do we have anything (with the grep that proves it)</th>
<th>Value to us</th>
<th>Rough cost</th>
</tr>
</thead>
<tbody>
<tr>
<td>1. Native end-to-end agent eval DSL, deterministic mock model, and LLM judges</td>
<td>eve 0.31.3; Flue has a smaller external <code>vitest-evals</code> recipe</td>
<td>Eve runs real HTTP/session evals with single- or multi-turn cases, datasets, deterministic assertions over messages/tools/subagents/events/order/structured output, hard or soft thresholds, a prompt-aware/tool-calling <code>mockModel</code>, and factuality/summary/closed-QA/SQL judges with rationale. <small>Sources: eve tag <code>docs/evals/{overview,assertions,judge}.mdx</code>; <code>packages/eve/CHANGELOG.md</code> 0.15.4. Flue: <code>ecosystem/tooling/vitest-evals.md:15-63</code>.</small></td>
<td>PARTIAL. We ship YAML suites, matchers, concurrency, tool-call capture, and HTTP injection under <code>packages/agent/src/eval</code>, but no live judge, deterministic model, trajectory/order DSL, or JUnit/Braintrust reporter. <code>git grep -i -l -E 'mockModel|llm.*judge|judge.*model|junit|braintrust.*report|eval.*threshold' origin/main -- packages plugins</code> → only an archived plan and <code>yamlSchema.test.ts</code>.</td>
<td>HIGH</td>
<td>L for assertions + mock; XL with judges/reporters/remote target parity</td>
</tr>
<tr>
<td>2. Per-session input/output token ceilings</td>
<td>eve 0.31.3</td>
<td><code>limits.maxInputTokensPerSession</code> and <code>maxOutputTokensPerSession</code> stop new model calls after accumulated provider-reported usage crosses the cap; root and delegated sessions have different safe defaults. This is hard session containment, not the spend metering already present in boring-ui. <small>Source: eve tag changelog 0.18.0.</small></td>
<td>NO equivalent. We have user/model currency budgets, pricing, usage accounting, and sandbox quotas, but no session-scoped model-token ceiling. <code>git grep -i -l -E 'maxInputTokensPerSession|maxOutputTokensPerSession|session.*token.*(cap|ceiling|limit)|token.*(cap|ceiling).*session' origin/main -- packages plugins</code> → no matches.</td>
<td>HIGH</td>
<td>S–M</td>
</tr>
<tr>
<td>3. Immutable, integrity-checked conversation attachment store</td>
<td>Flue 2.0.3</td>
<td>Turns base64 image parts into immutable digest/size/MIME references, verifies SHA-256 on write/read, makes concurrent identical puts idempotent, detects conflicts/corruption, chunks values too large for one database row, and serves conversation-scoped bytes with private immutable caching. <small>Sources: <code>reference/agent-api.md:116-142</code>; <code>reference/data-persistence-api.md:181-195,237-243</code>; <code>reference/streaming-protocol.md:48-75,332-341</code>.</small></td>
<td>PARTIAL. We have composer attachments, uploads, <code>readAttachment</code>, file parts, and workspace raw-file URLs, but not this immutable attachment object/store contract. <code>git grep -i -n -E 'AttachmentStore|AttachmentIntegrity|AttachmentConflict|sameAttachment|verifyAttachment|attachment.*digest|digest.*attachment' origin/main -- packages plugins</code> → no matches. Broader <code>attachment|mimeType|base64</code> grep finds the existing UI/upload path, hence the narrow claim.</td>
<td>HIGH</td>
<td>M–L</td>
</tr>
<tr>
<td>4. Zero-interruption dev generations with atomic promotion and drain</td>
<td>eve 0.31.3</td>
<td>Compiles/bundles/starts a candidate worker in isolation, promotes only a healthy generation, keeps the retired worker serving work and sockets it already admitted, leaves the last good worker alive after a bad build/crash, and bounds shutdown. Admitted turns stay pinned to immutable runtime generations; active generations are never pruned. <small>Source: eve tag changelog 0.24.3; <code>docs/reference/cli.md</code>.</small></td>
<td>NO generation-level equivalent. We do have plugin/agent hot reload and strong graceful host disposal, but not isolated candidate-worker promotion with admitted-work generation pinning. <code>git grep -i -l -E 'last-known-good|last known good|atomic.*promot|retired worker|generation.*drain|hot reload.*in.flight' origin/main -- packages plugins</code> → no matches.</td>
<td>HIGH</td>
<td>L–XL</td>
</tr>
<tr>
<td>5. Verified inbound-channel SPI with trusted outbound destination binding</td>
<td>Flue 2.0.3 and eve 0.31.3</td>
<td>First-party adapters verify exact provider ingress, preserve native typed/open payloads, map provider conversation/destination to a stable agent identity, dispatch durable work, and bind reply tools in trusted code so the model chooses content but never recipient, credential, callback URL, or bearer capability. Flue covers 17 providers; Eve covers Slack, Discord, GitHub, Linear, Teams, Telegram, Twilio, Photon/iMessage, and Chat SDK/HTTP. <small>Sources: all Flue <code>ecosystem/channels/*</code>; eve tag <code>docs/channels/*</code>.</small></td>
<td>NO generic equivalent. MCP connectors are outbound tool access, not inbound verified chat transport. <code>git grep -n -i -E 'create(Slack|Discord|Telegram|Teams|Twilio|WhatsApp|Messenger|GoogleChat|Linear|Notion|Resend|Shopify|Intercom|Zendesk|GitHub)Channel|webhook.*signature|x-slack-signature|channel adapter' origin/main -- packages plugins</code> → only product billing webhooks. GitHub tracker and Stripe billing are adjacent, not a channel SPI.</td>
<td>HIGH</td>
<td>L for SPI + two adapters; XL for ecosystem breadth</td>
</tr>
<tr>
<td>6. Typed arbitrary agent/session state with atomic same-turn updates</td>
<td>Flue 2.0.3 and eve 0.31.3</td>
<td>Flue's named JSON state setter resolves the previous value against a write buffer and atomically commits a whole parallel tool batch, avoiding same-turn lost updates and skipping deep-equal no-ops. Eve's <code>defineState</code> supplies typed scoped state. <small>Sources: Flue <code>reference/agent-hooks-api.md:190-208</code>; eve tag TypeScript API/state docs.</small></td>
<td>NO framework equivalent. Files and transcripts can hold state, and ask-user has a feature-local publisher, but there is no typed general agent-state API or atomic tool-batch commit. <code>git grep -i -l -E 'defineState|usePersistentState|atomic.*state|state.*write buffer|session state schema' origin/main -- packages plugins</code> → one archived workspace plan only.</td>
<td>HIGH</td>
<td>M–L</td>
</tr>
<tr>
<td>7. Policy-enforcement lifecycle hooks that can continue a response</td>
<td>Flue 2.0.3</td>
<td>Awaited start hooks can hydrate context/seed resources; finish hooks see aggregate tool activity and usage, may append durable steering, and can force another model cycle until policy passes, with a 32-cycle runaway ceiling. Response hooks attach model-hidden client metadata via safe deep merge. This is a runtime policy seam, not declarative agent composition. <small>Source: <code>reference/agent-hooks-api.md:271-373</code>.</small></td>
<td>NO equivalent. Existing host lifecycle methods start/stop bindings; they do not expose a per-response postcondition hook that can steer continuation. <code>git grep -i -l -E 'useAgentFinish|useResponseFinish|agent.*finish.*hook|response.*finish.*hook|continuation.*policy|finish.*steer' origin/main -- packages plugins</code> → no matches.</td>
<td>HIGH</td>
<td>M–L</td>
</tr>
<tr>
<td>8. Proxy-held secret injection for sandbox egress</td>
<td>Flue Cloudflare deployment recipe; Eve microsandbox broker/firewall</td>
<td>An outbound proxy intercepts sandbox HTTP(S), enforces domain/session policy, and injects credentials outside the sandbox so neither model context nor guest process ever receives the token. Eve additionally documents deny-all/domain egress policies and a credential broker. <small>Sources: Flue <code>ecosystem/deploy/cloudflare.md:429-449</code>; eve tag <code>docs/sandbox.mdx</code>.</small></td>
<td>PARTIAL. We have default-deny runsc evidence, egress-origin contracts, credential leases, fd-3 invocation delivery, and strong MCP endpoint policy, but no general HTTP proxy injection seam. <code>git grep -i -l -E 'proxy.*inject.*secret|secret.*inject.*proxy|egress.*proxy|credential broker|sandbox.*firewall' origin/main -- packages plugins</code> → only MCP proxy-policy text; <code>mcpSdkTransport.ts</code> explicitly notes proxy-only deployments need an egress seam.</td>
<td>HIGH</td>
<td>L</td>
</tr>
<tr>
<td>9. Standard OpenTelemetry GenAI semantic projection with content budget and durable trace context</td>
<td>Flue 2.0.3; Eve has a more general OTel hook</td>
<td>Projects agent/model/tool/task activity into pinned GenAI spans and low-cardinality metrics; persists validated <code>traceparent</code>/<code>tracestate</code> through recovery; offers content transforms/off switches; enforces a shared 56 KiB span budget while preserving valid JSON and explicit truncation/drop sentinels. <small>Source: Flue <code>ecosystem/tooling/opentelemetry.md:10-90</code>; Eve <code>docs/guides/instrumentation.md</code>.</small></td>
<td>NO shipped semantic projection. We depend on <code>@opentelemetry/api</code> and have PostHog/DB telemetry plus an archived app telemetry plan. <code>git grep -i -l -E 'GenAI|gen_ai|truncateContent|tracestate|traceparent|OpenTelemetry.*agent|OTLP' origin/main -- packages plugins</code> → archived plan only.</td>
<td>HIGH</td>
<td>M–L</td>
</tr>
<tr>
<td>10. Smart full-project agent scaffold</td>
<td>Flue 2.0.3 and eve 0.31.3</td>
<td>Creates a complete runnable project, not merely a plugin: package/TS/config/env/agent/router/database/deploy skeleton, runtime target choice, safe existing-directory behavior, non-TTY validation, package-manager/workspace detection, optional web chat, Git init, and coding-agent handoff. <small>Sources: Flue <code>cli/init.md:10-47</code>; eve tag <code>docs/reference/cli.md:222-235</code>.</small></td>
<td>NO full project scaffold. We have excellent <code>boring-ui-plugin scaffold</code> and runtime workspace templates, but no create/init flow for a new boring-ui agent app. <code>git grep -i -n -E 'scaffold|init.*project|create.*project|kept existing' origin/main -- packages/agent packages/cli plugins</code> → plugin scaffolding and archived plans only.</td>
<td>HIGH</td>
<td>M</td>
</tr>
<tr>
<td>11. <code>info --json</code> resolved-capability inspection</td>
<td>eve 0.31.3</td>
<td>Inspects tools, skills, subagents, schedules, channels, routes, compiled artifacts, and discovery diagnostics without booting the server; emits stable machine-readable output. <small>Source: eve tag <code>docs/reference/cli.md:202-221,275-283</code>.</small></td>
<td>PARTIAL. We expose readiness/capability projections and plugin status, but no one command inventories the fully resolved agent graph. <code>git grep -i -l -E 'info --json|agent info|agent-discovery-manifest|discovered.*channels|discovered.*schedules' origin/main -- packages plugins</code> → only runtime-plugin test fixtures.</td>
<td>HIGH</td>
<td>S–M</td>
</tr>
<tr>
<td>12. Zero-config local trace spool, viewer, privacy controls, and issue bundle</td>
<td>eve 0.31.3</td>
<td>Writes immutable OTLP/JSON segments; indexes by trace/session/prefix; reconstructs parent/subagent span trees; shows tokens, cost, models, payloads, and errors; captures process/tool/workflow logs as JSONL; and produces a time-interleaved issue dump. Retention defaults to 7 days/512 MB/newest 20 and skips malformed segments. <small>Source: eve tag <code>docs/reference/cli.md:372-411</code>.</small></td>
<td>NO equivalent local investigation product. We have event stores, telemetry sinks, a debug drawer, and cost dashboards, but no bounded local trace spool/viewer/dump lifecycle. <code>git grep -i -l -E 'trace.*spool|immutable.*trace|trace.*viewer|trace.*retention|log bundle|structured JSONL' origin/main -- packages plugins</code> → no matches.</td>
<td>HIGH</td>
<td>L</td>
</tr>
<tr>
<td>13. Caller-visible conditional conversation incarnation CAS</td>
<td>Flue 2.0.3</td>
<td>An instance UID works like an ETag: a string means continue only that incarnation, <code>null</code> means create only, omission means continue-or-create. Failed conditions admit nothing and create no state; conflicts return the existing UID. <small>Sources: <code>reference/agent-api.md:187-197</code>; <code>sdk/flue-client.md:49-54</code>.</small></td>
<td>PARTIAL internally, absent publicly. Our Pi session deletion/cold-open code has incarnation fences, but callers cannot make create-only/continue-only sends against a public conversation generation. <code>git grep -i -n -E 'incarnation|create-only|continue-only|instance uid|uid.*ETag|conditional send' origin/main -- packages plugins</code> → internal harness/session hits only.</td>
<td>HIGH</td>
<td>M</td>
</tr>
<tr>
<td>14. Reusable sandbox bootstrap/template/prewarm lifecycle</td>
<td>eve 0.31.3</td>
<td>Seeds authored workspace files, runs one-time <code>bootstrap</code>, runs per-session <code>onSession</code>, invalidates with <code>revalidationKey</code>, caches images/snapshots, and prewarms hosted templates during build with phase-aware diagnostics. <small>Source: eve tag <code>docs/sandbox.mdx</code>.</small></td>
<td>PARTIAL. We have fingerprinted runtime provisioning, templates, Vercel base snapshots, and lazy repair, but no unified backend-neutral bootstrap/onSession/revalidation/prewarm contract. <code>git grep -i -l -E 'revalidationKey|sandbox.*prewarm|prewarm.*sandbox|sandbox.*template.*cache|microsandbox' origin/main -- packages plugins</code> → no implementation match; only unrelated <code>onSession</code> text.</td>
<td>HIGH</td>
<td>L</td>
</tr>
<tr>
<td>15. Durable schema-validated client progress parts and file-valued model output</td>
<td>Flue 2.0.3 and eve 0.31.3</td>
<td>Flue can append named schema-validated JSON parts durably, stream them immediately, and update a part in place while hiding it from the model. Eve tool output builders can return text plus file content so screenshots/charts reach vision models as pixels; missing staged bytes degrade to a model-visible notice instead of killing history replay. <small>Sources: Flue <code>reference/agent-hooks-api.md:252-269</code>; eve changelog 0.20.0 and 0.27.9.</small></td>
<td>PARTIAL. We stream tool/UI events and have file uploads, but no public durable progress-part writer or general file-valued tool-result contract. <code>git grep -i -l -E 'structured.*progress|data part|file-valued tool|toModelOutput|FileNotFound.*attachment|missing attachment' origin/main -- packages plugins</code> → archived plans plus agent-consumption types, no shipped API.</td>
<td>HIGH</td>
<td>M</td>
</tr>
<tr>
<td>16. Stable machine-readable discovery/build diagnostic artifacts</td>
<td>eve 0.31.3</td>
<td>Emits <code>.eve/discovery/agent-discovery-manifest.json</code>, <code>diagnostics.json</code>, compiled manifest/module maps, and severity/message/source records; build errors point at the artifact for downstream tooling. <small>Source: eve tag <code>docs/reference/cli.md:202-221,301-308</code>.</small></td>
<td>NO equivalent artifact set. We have stable runtime error codes and various status endpoints, but no compiler/discovery diagnostic manifest. <code>git grep -i -l -E 'diagnostics.json|agent-discovery-manifest|discovery manifest|compiled manifest|module map' origin/main -- packages plugins</code> → no relevant matches.</td>
<td>HIGH</td>
<td>M</td>
</tr>
<tr>
<td>17. Eval runner selection, concurrency, timeout, and CI output contract</td>
<td>eve 0.31.3; Flue ecosystem recipe</td>
<td>Selects by exact ID/directory prefix/tag/excluded tag; forces per-eval timeouts even if the case ignores abort; limits concurrency (default 8); targets local or deployed agents; emits JSON/JUnit; and guarantees exit codes 0/1/2. Flue's companion captures exact event order, normalized tool calls/usage/cost, JSON reports, a local viewer, and GitHub summary publishing. <small>Sources: eve tag <code>docs/reference/cli.md:424+</code>; Flue <code>ecosystem/tooling/vitest-evals.md:15-63</code>.</small></td>
<td>PARTIAL. Our suite runner has YAML selection and concurrency, but no tag/exclude-tag contract, forced case timeout, JUnit, stable tri-state exit-code spec, deployed-base-URL parity, or report viewer. Same eval grep as row 1 finds only the current schema test plus archived plan.</td>
<td>HIGH</td>
<td>M</td>
</tr>
<tr>
<td>18. Version-matched offline documentation search/read CLI</td>
<td>Flue 2.0.3; eve ships its full docs in the npm package</td>
<td>Flue bundles 95 pages with the installed version and exposes an offline index, Markdown reader accepting catalog paths/URLs/source filenames, and ranked full-text JSON search. Eve explicitly ships its complete documentation under <code>node_modules/eve/docs</code>. <small>Source: Flue <code>cli/docs.md:15-60</code>; eve repository README.</small></td>
<td>NO docs command or packaged searchable docs contract. <code>git grep -i -n -E 'docs (search|read)|offline documentation|bundled docs|version-matched' origin/main -- packages plugins</code> → no matches.</td>
<td>MED</td>
<td>S–M</td>
</tr>
<tr>
<td>19. Agent-consumable integration add/update blueprints</td>
<td>Flue 2.0.3</td>
<td><code>flue add</code> and <code>flue update</code> fetch Markdown implementation/update guides for channels, databases, sandboxes, and observability; arbitrary provider-doc URLs can seed a new adapter; output pipes cleanly into a coding agent; updates explicitly preserve project customization. <small>Sources: <code>cli/add.md:13-48</code>; <code>cli/update.md:13-39</code>.</small></td>
<td>NO equivalent. We have plugin scaffolding and package-resource discovery, not framework-maintained agent-readable integration/update recipes. <code>git grep -i -n -E 'blueprint|integration guide|provider docs|preserve custom' origin/main -- packages plugins</code> → archived planning language only.</td>
<td>MED</td>
<td>M</td>
</tr>
<tr>
<td>20. Searchable installable integration registry with setup flows</td>
<td>eve 0.31.3</td>
<td>Supports official/configured shadcn-style registries, list/search/view/add, JSON output, package/skill installation, composable product components, setup flows, and <code>--skip-install</code>. <small>Source: eve tag <code>docs/reference/cli.md:258-274</code>; changelog 0.29.4/0.30.5.</small></td>
<td>PARTIAL. We have plugin source manifests, install/status/scaffold/test, and an MCP connector catalog, but no unified searchable framework integration registry spanning agent/channel/sandbox/UI components. <code>git grep -i -l -E 'registry list|registry search|connections add|integration registry|catalog.*connection' origin/main -- packages plugins</code> → CLI front shell, an archived plugin plan, and boring-mcp README only.</td>
<td>MED</td>
<td>L</td>
</tr>
<tr>
<td>21. CLI environment/link bootstrap with live env reload</td>
<td>eve 0.31.3</td>
<td>Every command loads root <code>.env</code>/<code>.env.local</code>; <code>eve link</code> selects/verifies a Vercel project and pulls OIDC/Gateway credentials into <code>.env.local</code>; dev reloads environment changes without restart. <small>Source: eve tag <code>docs/reference/cli.md:198,412-416</code>.</small></td>
<td>PARTIAL. We have strict env/config loading, file secrets, credential vaults, and OIDC refresh, but no project-link/pull workflow or general dev env hot reload. <code>git grep -i -l -E 'env.*hot.reload|hot.reload.*env|vercel link|pull.*\.env.local|project.*link.*credential' origin/main -- packages plugins</code> → no framework CLI flow.</td>
<td>MED</td>
<td>M</td>
</tr>
<tr>
<td>22. Build profiler plus failure-safe concurrent build publication</td>
<td>eve 0.31.3</td>
<td><code>eve build --profile</code> writes versioned phase timing, file count, raw/gzip bytes, and per-function subtotals. Invocation-owned scratch directories permit build beside dev; failed builds preserve the last successful output; publish windows serialize. <small>Source: eve tag <code>docs/reference/cli.md:284-299</code>.</small></td>
<td>NO equivalent agent-build diagnostic/publish contract. <code>git grep -i -l -E 'build.*profile|phase timings|gzip bytes|scratch.*build|last successful.*output|concurrent.*publish' origin/main -- packages plugins</code> → provisioning test and archived plugin-plan noise only.</td>
<td>MED</td>
<td>M–L</td>
</tr>
<tr>
<td>23. ACP v1 stdio bridge</td>
<td>eve 0.31.3</td>
<td><code>eve acp [url]</code> exposes a local or deployed agent over Agent Client Protocol JSON-RPC on stdio, including streaming, tool activity, HITL, cancellation, concurrent sessions, and Vercel auth. <small>Source: eve tag changelog 0.29.4 and CLI reference.</small></td>
<td>NO equivalent. <code>git grep -i -l -E '\bACP\b|agent client protocol|stdio.*JSON-RPC|json-rpc.*stdio' origin/main -- packages plugins</code> → no matches.</td>
<td>MED</td>
<td>M–L</td>
</tr>
<tr>
<td>24. Compiled reusable extension packages</td>
<td>eve 0.31.3</td>
<td><code>eve extension init/build</code> scaffolds and builds a namespaced bundle of tools, connections, skills, instructions, hooks, and state, emitting declarations, compatibility metadata, exports, and an agent-shaped distribution tree without TypeScript source. <small>Source: eve tag <code>docs/reference/cli.md:236-257</code>.</small></td>
<td>PARTIAL. Our plugin CLI scaffolds/tests workspace plugins and packages can contribute runtime resources, but there is no agent-extension compiler with compatibility metadata and a source-free agent-shaped artifact. <code>git grep -i -l -E 'extension init|extension build|compatibility metadata|package.*agent.*extension' origin/main -- packages plugins</code> → plugin docs/system-prompt references only.</td>
<td>MED</td>
<td>L</td>
</tr>
<tr>
<td>25. Rich terminal development client</td>
<td>eve 0.31.3</td>
<td>Interactive local/remote chat with model/connect/deploy setup, logs/traces, approvals/questions, cancel/reset/clear/compact, queued follow-ups, history, grapheme-safe multiline editing, alternate tool/reasoning/subagent renderers, context-window and tokens/sec stats, and repeatable custom headers. <small>Sources: eve tag <code>docs/reference/cli.md:319-348</code>; <code>docs/guides/dev-tui.md</code>.</small></td>
<td>NO terminal client equivalent; our CLI launches a browser UI/server. Grep is noisy because our web chat renders terminal tools, but contains no TUI client implementation: <code>git grep -i -l -E 'terminal UI|TUI|grapheme|multiline input|remote URL.*header' origin/main -- packages plugins</code>.</td>
<td>MED</td>
<td>L</td>
</tr>
<tr>
<td>26. Dev-server discovery and safe TUI reuse</td>
<td>eve 0.31.3</td>
<td>Persists a per-app healthy loopback URL; a second TUI attaches to the live dev server with a fresh session; stale records are detected and replaced. <small>Source: eve tag <code>docs/reference/cli.md:367-370</code>.</small></td>
<td>NO equivalent client/server reuse record. <code>git grep -i -l -E 'dev server.*reuse|reuse.*dev server|healthy loopback|stale.*server record|attach.*existing server' origin/main -- packages plugins</code> → no relevant matches.</td>
<td>LOW</td>
<td>S–M</td>
</tr>
<tr>
<td>27. Model modality guard for image inputs</td>
<td>Flue 2.0.3</td>
<td>The model catalog declares input modalities; when a selected model is text-only, attached images are deterministically replaced with <code>(image omitted)</code> instead of being blindly sent or failing provider-side. <small>Source: <code>guide/models.md:192</code>.</small></td>
<td>NO equivalent guard found. <code>git grep -i -l -E 'image omitted|input modalities|vision-capable|supports.*image' origin/main -- packages plugins</code> → no matches.</td>
<td>MED</td>
<td>S</td>
</tr>
<tr>
<td>28. Model catalog as an executable behavior source</td>
<td>Flue 2.0.3</td>
<td>Catalog metadata supplies context/output limits, cost rates, reasoning capability, and input modalities; unknown models fail before a provider request; a normalized reasoning-effort vocabulary is dropped safely for non-reasoning models. <small>Source: <code>guide/models.md:32-70</code>.</small></td>
<td>PARTIAL. Our model config exposes provider/model options and pricing/metering knows cache costs, but there is no single public behavior catalog with modality/reasoning/context validation. <code>git grep -i -l -E 'input modalities|reasoning effort|xhigh|unknown.*model.*before|contextWindow.*cost' origin/main -- packages plugins</code> → model config/pricing fragments, not an equivalent catalog.</td>
<td>MED</td>
<td>M</td>
</tr>
<tr>
<td>29. Build-time provider allowlist and tree shaking</td>
<td>Flue 2.0.3</td>
<td>Configured provider IDs generate only selected imports; target-incompatible Cloudflare providers fail validation; project registration can override; missing provider imports fail at build rather than first request. <small>Source: <code>reference/configuration.md:122-132</code>.</small></td>
<td>NO model-provider build allowlist. <code>git grep -i -l -E 'tree-shak.*provider|provider.*allowlist|selected provider.*import|missing provider.*build' origin/main -- packages plugins</code> → only MCP tool allowlists.</td>
<td>MED</td>
<td>S–M</td>
</tr>
<tr>
<td>30. Live agent-set discovery with last-known-good fallback</td>
<td>Flue 2.0.3</td>
<td>Adding/removing agent modules or exports updates the registry during dev; syntax and duplicate-identity failures report diagnostics but retain the last good agent set rather than taking down development. <small>Sources: <code>reference/configuration.md:276-289</code>; <code>guide/node-target.md:24-33</code>.</small></td>
<td>PARTIAL. We hot-reload plugins/agent definitions and have reload edge-case tests, but no explicit last-good agent registry after a failed source scan. <code>git grep -i -l -E 'last-known-good|last known good|agent.*scan.*fail|duplicate.*identity.*retain' origin/main -- packages plugins</code> → no matches.</td>
<td>MED</td>
<td>M</td>
</tr>
<tr>
<td>31. Turnkey Sentry agent semantics</td>
<td>Flue 2.0.3</td>
<td>Maps terminal failures to deduplicated issues, every log to Sentry, and a whole conversation to one trace; bounds flush; supports Cloudflare DO wrapping; suppresses duplicate provider instrumentation; makes content opt-in with a 16 KiB attribute budget. <small>Source: <code>ecosystem/tooling/sentry.md:15-110</code>.</small></td>
<td>NO integration. <code>git grep -i -n -E '\bsentry\b|@sentry/' origin/main -- packages plugins</code> → only a Warden benchmark fixture discussing historical Sentry commits, no runtime bridge.</td>
<td>MED</td>
<td>M</td>
</tr>
<tr>
<td>32. Turnkey Braintrust trace/cost bridge</td>
<td>Flue 2.0.3</td>
<td>Exports model/tool/task/compaction spans, token usage, estimated cost, and submission correlation with masking controls; documents best-effort Cloudflare delivery limitations honestly. <small>Source: <code>ecosystem/tooling/braintrust.md:17-77</code>.</small></td>
<td>NO runtime integration. <code>git grep -i -n -E 'Braintrust|braintrust.*trace|braintrust.*span' origin/main -- packages plugins</code> → archived eval-plan/report language only.</td>
<td>MED</td>
<td>S–M</td>
</tr>
<tr>
<td>33. External versioned trajectory/rubric bridge</td>
<td>Flue 2.0.3 via Jetty</td>
<td>Stores comparable labeled trajectories and grader configuration separately from the agent so implementation changes cannot silently change the rubric used to judge them; includes a sensitive-data warning. <small>Source: <code>ecosystem/tooling/jetty.md:17-84</code>.</small></td>
<td>NO equivalent. <code>git grep -i -n -E 'Jetty|trajectory.*rubric|rubric.*trajectory|grader config' origin/main -- packages plugins</code> → no matches.</td>
<td>LOW — they have it; we do not need a Jetty-specific bridge now</td>
<td>S</td>
</tr>
<tr>
<td>34. Official agent-runtime persistence backend matrix</td>
<td>Flue 2.0.3</td>
<td>Ships concrete adapters/blueprints for Postgres, MySQL, MongoDB, Redis, Valkey, libSQL, Turso, and Supabase, including runtime schema/version management and driver seams. This is provider breadth beyond the already-listed persistence adapter contract. <small>Sources: all eight <code>ecosystem/databases/*</code> pages.</small></td>
<td>NO agent-conversation backend matrix. We have SQLite chat/event storage and many Postgres business/metering stores, but no interchangeable runtime stores for these databases. <code>git grep -i -n -E 'MongoDB|libSQL|Turso|Valkey|Redis|Supabase|mysql2|PersistenceAdapter|database adapter|embedded replica' origin/main -- packages plugins</code> → SQLite/Postgres application code and irrelevant fixtures, no runtime adapters.</td>
<td>MED</td>
<td>XL for matrix; M per demanded backend</td>
</tr>
<tr>
<td>35. Multipart atomic Mongo large-value storage</td>
<td>Flue 2.0.3</td>
<td>Works around BSON's 16 MiB ceiling by serializing into immutable ≤4 MiB parts, atomically publishing a generation/manifest in a short transaction, and garbage-collecting abandoned/retired generations; images reuse the path. <small>Source: <code>ecosystem/databases/mongodb.md:117-127</code>.</small></td>
<td>NO equivalent generic large-record staging. <code>git grep -i -n -E 'BSON|staged writes|multipart.*generation|immutable.*parts|manifest.*parts' origin/main -- packages plugins</code> → no matches.</td>
<td>HIGH if we adopt a durable attachment/large-value store</td>
<td>M</td>
</tr>
<tr>
<td>36. Mongo topology, transaction, and unknown-commit diagnostics</td>
<td>Flue 2.0.3</td>
<td>Fails startup on standalone/non-transactional topology; serializes session-bound operations; separates retry of a transient full callback from retry of unknown commit results; validates indexes/schema and refuses newer/incompatible data. <small>Source: <code>ecosystem/databases/mongodb.md:69-115</code>.</small></td>
<td>NO Mongo runtime adapter, therefore none of these guardrails. Same database grep as row 34 finds no Mongo implementation.</td>
<td>LOW–MED — only if Mongo is demanded</td>
<td>M</td>
</tr>
<tr>
<td>37. Redis/Valkey durability preflight</td>
<td>Flue 2.0.3</td>
<td>Requires standalone/single-shard deployment, recommends AOF/snapshotting, inspects <code>CONFIG GET</code>/<code>INFO</code>, and fails closed for cluster mode or non-<code>noeviction</code> unless inspection is explicitly disabled. <small>Sources: <code>ecosystem/databases/redis.md:59-109</code>; <code>valkey.md:63-109</code>.</small></td>
<td>NO Redis/Valkey agent store. Same database grep finds no runtime adapter or <code>inspectServer</code>/<code>noeviction</code> guard.</td>
<td>LOW–MED — useful only with that backend</td>
<td>S–M per adapter</td>
</tr>
<tr>
<td>38. libSQL/Turso embedded replicas and serialized local writes</td>
<td>Flue 2.0.3</td>
<td>Supports local file, self-hosted, remote Turso, and local read replicas that sync from remote while forwarding writes; serializes embedded operations to avoid <code>SQLITE_BUSY</code> and explicitly disclaims multiprocess ownership. <small>Sources: <code>ecosystem/databases/libsql.md:117-167</code>; <code>turso.md:117-164</code>.</small></td>
<td>NO embedded-replica backend. We do handle SQLite busy/retry locally, which is an adjacent and in places stronger implementation. <code>git grep -i -n -E 'embedded replica|Turso|libSQL|sync.*replica' origin/main -- packages plugins</code> → no matches.</td>
<td>LOW — they have it; we probably do not need it</td>
<td>M</td>
</tr>
<tr>
<td>39. Additional sandbox-provider adapter catalog</td>
<td>Flue 2.0.3</td>
<td>Provides standard exec/files/cancel/delete integration blueprints for boxd, Daytona, E2B, exe.dev SSH/SFTP, islo, Mirage, Modal, Cloudflare Sandbox, and Cloudflare Computer while leaving lifecycle ownership explicit. <small>Sources: all ten <code>ecosystem/sandboxes/*</code> pages; Vercel omitted here because we already support it.</small></td>
<td>NO adapters for those providers. We do have real Direct, bwrap, runsc, remote-worker, node-workspace, and Vercel providers. <code>git grep -i -n -E 'E2B|Daytona|Modal|boxd|exe.dev|islo|Mirage|Cloudflare Sandbox|Cloudflare Computer' origin/main -- packages plugins</code> → no live provider implementation.</td>
<td>LOW–MED — breadth is marketing until a user asks</td>
<td>L–XL for matrix</td>
</tr>
<tr>
<td>40. Durable no-container Cloudflare Computer workspace</td>
<td>Flue 2.0.3 ecosystem</td>
<td>Uses a Durable Object-local SQLite filesystem plus Dynamic Worker/just-bash, supports the standard coding-tool surface, survives DO restarts, and allows app-side Git/filesystem hydration up to roughly 10 GB; docs label it early preview. <small>Source: <code>ecosystem/sandboxes/cloudflare-computer.md:7-30,83-89</code>.</small></td>
<td>NO Cloudflare/DO runtime target. <code>git grep -i -n -E 'Durable Object|Cloudflare Computer|Dynamic Worker|wrangler' origin/main -- packages plugins</code> → no relevant implementation.</td>
<td>LOW — platform mismatch today</td>
<td>L</td>
</tr>
<tr>
<td>41. Generated Cloudflare Durable Object agent deployment and safe extension seams</td>
<td>Flue 2.0.3</td>
<td>Generates one DO class/binding per agent identity, validates compatibility/migration config, and exposes constrained <code>base</code>/<code>wrap</code> hooks for startup/scheduling/queue integrations while preventing overrides of routing/recovery/alarm invariants. <small>Sources: <code>ecosystem/deploy/cloudflare.md:54-107,188-265</code>; <code>guide/cloudflare-target.md</code>.</small></td>
<td>NO Cloudflare deployment target. <code>git grep -i -n -E 'new_sqlite_classes|run_worker_first|worker_loaders|DurableObjectIdentity|getCloudflareContext|wrangler' origin/main -- packages plugins</code> → no relevant implementation.</td>
<td>LOW — do not build unless Cloudflare becomes a target</td>
<td>XL</td>
</tr>
<tr>
<td>42. First-party deployment cookbook matrix</td>
<td>Flue 2.0.3</td>
<td>Maintains concrete Docker, AWS ECS/EC2/Fargate, Cloudflare, Fly, Railway, Render, SST, Node, GitHub Actions, and GitLab CI guides with secret-store wiring, stream timeout/resume caveats, affinity, persistence, and platform-specific commands. <small>Sources: all <code>ecosystem/deploy/*</code> pages.</small></td>
<td>NO comparable supported target matrix under <code>packages</code>/<code>plugins</code>; we have Docker/Vercel/local/runsc operational material. <code>git grep -i -l -E 'deploy.*(Fly|Railway|Render|Fargate|SST|GitLab)|Fly\.toml|render\.yaml' origin/main -- packages plugins</code> → no target cookbooks.</td>
<td>LOW — they have it; we do not need ten first-party targets</td>
<td>M for docs; ongoing maintenance dominates</td>
</tr>
<tr>
<td>43. Non-root, signal-correct Docker production template</td>
<td>Flue 2.0.3</td>
<td>Documents a multistage production-dependency image, secret-safe <code>.dockerignore</code>, non-root UID, and init/tini signal forwarding so in-flight streams shut down cleanly. <small>Source: <code>ecosystem/deploy/docker.md:13-39</code>.</small></td>
<td>PARTIAL. We have a multistage reference Dockerfile and strong graceful shutdown, but it remains root and has no init wrapper. <code>git grep -i -n -E '\btini\b|\bdumb-init\b|signal forwarding|^USER [1-9][0-9]*' origin/main -- packages plugins</code> → only unrelated archived “abort signal forwarding” prose.</td>
<td>LOW — useful documentation, not strategic differentiation</td>
<td>S</td>
</tr>
<tr>
<td>44. Slack channel: assistant threads, native streaming, retries, capability hygiene</td>
<td>Flue 2.0.3 and eve 0.31.3</td>
<td>Handles Events API/interactivity/slash commands, signed challenges, native Assistant thread status and streamed replies, rate-limit/retry headers, and keeps <code>trigger_id</code>/<code>response_url</code> out of model/history. Eve additionally splits oversized approval blocks. <small>Source: Flue <code>ecosystem/channels/slack.md:81-335</code>; eve channel docs/changelog.</small></td>
<td>NO inbound Slack agent channel. Generic channel grep in row 5 has no Slack adapter; MCP/connector access is outbound and not equivalent.</td>
<td>HIGH</td>
<td>M</td>
</tr>
<tr>
<td>45. GitHub webhook-to-agent channel</td>
<td>Flue 2.0.3 and eve 0.31.3</td>
<td>Verifies exact signed webhooks, forwards every native event without a fixed supported list, internally acknowledges ping, binds repo/issue destination to a trusted comment tool, and documents 10-second/manual-redelivery semantics. <small>Source: Flue <code>ecosystem/channels/github.md:237-297</code>; eve GitHub channel docs.</small></td>
<td>ADJACENT, not equivalent. We have a GitHub PR tracker and task source, but not a generic verified webhook→durable-agent channel. Generic channel grep in row 5 finds no <code>createGitHubChannel</code> or channel adapter.</td>
<td>HIGH</td>
<td>M</td>
</tr>
<tr>
<td>46. Resend inbound-email channel with lazy body/attachment retrieval</td>
<td>Flue 2.0.3</td>
<td>Verifies Svix exact bytes, sends only routing and attachment descriptors to the agent, and exposes a trusted bound tool to fetch full body/headers/signed attachment URLs later; explicitly avoids inventing unstable thread identity and documents unordered at-least-once delivery. <small>Source: <code>ecosystem/channels/resend.md:169-233</code>.</small></td>
<td>NO email channel. <code>git grep -i -n -E 'Svix|Resend.*webhook|inbound email|email.*channel' origin/main -- packages plugins</code> → email sending/business auth references, no inbound-agent adapter.</td>
<td>HIGH if email becomes a first-class surface</td>
<td>M</td>
</tr>
<tr>
<td>47. Discord signed HTTP interactions</td>
<td>Flue 2.0.3 and eve 0.31.3</td>
<td>Verifies Ed25519 HTTP interactions, handles PING→PONG internally, preserves commands/autocomplete/components/modals, meets the 3-second defer deadline, treats the 15-minute follow-up token as a hidden capability, and rejects stale signed requests. <small>Source: Flue <code>ecosystem/channels/discord.md:120-229,282-289</code>.</small></td>
<td>NO Discord channel. Generic channel grep in row 5 returns no Discord adapter/interaction verifier.</td>
<td>MED</td>
<td>M</td>
</tr>
<tr>
<td>48. Linear Agent Sessions channel</td>
<td>Flue 2.0.3 and eve 0.31.3</td>
<td>Verifies exact-body signatures and one-minute freshness; restricts organization/webhook; maps native AgentSession created/prompted events and activity; documents five-second webhook and ten-second progress expectations plus retry schedule. <small>Source: Flue <code>ecosystem/channels/linear.md:286-334</code>.</small></td>
<td>NO Linear channel. Generic channel grep finds neither a Linear signature verifier nor AgentSession adapter.</td>
<td>MED</td>
<td>M</td>
</tr>
<tr>
<td>49. Google Chat dual direct/Pub/Sub ingress</td>
<td>Flue 2.0.3</td>
<td>Supports direct Chat interactions and authenticated Workspace Events via Pub/Sub for messages, reactions, memberships, and spaces; preserves the CloudEvent envelope; handles subscription suspension/expiry; exchanges and caches service-account tokens; documents message-id retries. <small>Source: <code>ecosystem/channels/google-chat.md:135-145,228-307,364-375</code>.</small></td>
<td>NO Google Chat channel. Generic channel grep finds no adapter.</td>
<td>MED</td>
<td>L</td>
</tr>
<tr>
<td>50. WhatsApp full media/status channel with bearer-media isolation</td>
<td>Flue 2.0.3</td>
<td>Handles batched entries/changes/messages/statuses across text, image, audio, video, documents, stickers, locations, contacts, interactions, orders, reactions, and delivery states; uses stable BSUID identity; keeps media IDs/transient URLs out of model context and fetches in trusted code. <small>Source: <code>ecosystem/channels/whatsapp.md:321-366</code>.</small></td>
<td>NO WhatsApp channel. Generic channel grep finds no adapter.</td>
<td>MED for support products</td>
<td>M–L</td>
</tr>
<tr>
<td>51. Twilio SMS/MMS plus signed delivery-state channel</td>
<td>Flue 2.0.3 and eve 0.31.3</td>
<td>Preserves exact signed PascalCase form data including repeated fields/media/opt-out/idempotency token; verifies delivery callbacks; handles open future statuses and out-of-order MessageSid transitions; keeps media fetch trusted-side; documents 15-second/fallback/retry semantics. <small>Source: Flue <code>ecosystem/channels/twilio.md:258-320</code>.</small></td>
<td>NO Twilio channel. Generic channel grep finds no adapter.</td>
<td>MED for communications products</td>
<td>M</td>
</tr>
<tr>
<td>52. Telegram business/forum/topic identity and capability hygiene</td>
<td>Flue 2.0.3 and eve 0.31.3</td>
<td>Verifies secret-token header/body limit, forwards native Update, uses <code>update_id</code> for ordering/dedupe, distinguishes business chats/forum threads/channel-DM topics, and refuses to treat guest/inline callback capabilities as durable destinations. <small>Source: Flue <code>ecosystem/channels/telegram.md:293-333</code>.</small></td>
<td>NO Telegram channel. Generic channel grep finds no adapter.</td>
<td>LOW–MED</td>
<td>M</td>
</tr>
<tr>
<td>53. Teams Bot Connector auth and sovereign-cloud overrides</td>
<td>Flue 2.0.3 and eve 0.31.3</td>
<td>Verifies Microsoft OpenID RS256, issuer/audience/expiry, <code>msteams</code> key endorsement, exact signed <code>serviceUrl</code>, and tenant/channel constraints; supports sovereign metadata overrides and Connector reply-token caching. <small>Source: Flue <code>ecosystem/channels/teams.md:165-229</code>.</small></td>
<td>NO Teams chat channel. Generic channel grep finds no adapter; SharePoint integration is not equivalent.</td>
<td>LOW</td>
<td>M–L</td>
</tr>
<tr>
<td>54. Messenger batched events, handover, and messaging-window policy</td>
<td>Flue 2.0.3</td>
<td>Verifies Meta challenge/HMAC, preserves batched entry/messaging/standby/change families including handover and echoes, distinguishes PSID from <code>user_ref</code>, hides notification tokens, and documents the 24-hour/one-time-notification policy. <small>Source: <code>ecosystem/channels/messenger.md:231-288</code>.</small></td>
<td>NO Messenger channel. Generic channel grep finds no adapter.</td>
<td>LOW — they have it; we do not need it without a product case</td>
<td>M</td>
</tr>
<tr>
<td>55. Notion two-phase webhook verification and lazy resource fetch</td>
<td>Flue 2.0.3</td>
<td>Separates the unsigned one-time verification-token callback from recurring exact-body HMAC, fails 503 until configured, forwards a change descriptor rather than eager content, and documents up to eight unordered exponential retries. <small>Source: <code>ecosystem/channels/notion.md:243-292</code>.</small></td>
<td>NO inbound Notion channel. We have an outbound MCP template; generic channel grep finds no webhook adapter.</td>
<td>LOW</td>
<td>M</td>
</tr>
<tr>
<td>56. Shopify lossless webhook correctness and secret rotation</td>
<td>Flue 2.0.3</td>
<td>Uses exact-body HMAC/JSON-only ingress, lossless JSON for unsafe 64-bit IDs, prior-secret overlap, separate webhook/event idempotency, deadline/retry semantics, and mandatory GDPR topics that may arrive after uninstall. <small>Source: <code>ecosystem/channels/shopify.md:315-400</code>.</small></td>
<td>NO Shopify channel. <code>git grep -i -n -E 'x-shopify-hmac|Shopify.*webhook|lossless-json' origin/main -- packages plugins</code> → no matches.</td>
<td>LOW — they have it; we do not need it now</td>
<td>M</td>
</tr>
<tr>
<td>57. Generic Stripe snapshot/thin-event agent channel</td>
<td>Flue 2.0.3</td>
<td>Supports both snapshot and thin notifications, refetches the event/related object with correct client context, rejects payload/mode mismatch, and documents three-day unordered duplicate delivery and event-vs-resource idempotency. <small>Source: <code>ecosystem/channels/stripe.md:208-263</code>.</small></td>
<td>PARTIAL. Our credits package has a proper Stripe billing verifier, but no generic webhook-to-agent channel or thin-event refetch surface. Generic channel grep finds billing code only.</td>
<td>LOW — existing billing path is enough unless Stripe becomes an agent input</td>
<td>M</td>
</tr>
<tr>
<td>58. Intercom delivery-status semantics</td>
<td>Flue 2.0.3</td>
<td>Handles unsigned HEAD validation, exact-body HMAC-SHA1, open native notifications, 410 subscription-disable semantics, 429 throttling, the roughly five-second deadline, one retry, duplicates, and out-of-order events. <small>Source: <code>ecosystem/channels/intercom.md:300-367</code>.</small></td>
<td>NO Intercom channel. Generic channel grep finds no adapter.</td>
<td>LOW — do not build without demand</td>
<td>M</td>
</tr>
<tr>
<td>59. Zendesk lossless envelopes and fail-closed retry signaling</td>
<td>Flue 2.0.3</td>
<td>Verifies timestamp plus exact bytes and account/webhook constraints, preserves unsafe integers/future fields, separates signed provider envelope from routing headers, converts thrown/invalid handling into retryable 409, and documents distinct 409/429/503/timeout retries. <small>Source: <code>ecosystem/channels/zendesk.md:361-445</code>.</small></td>
<td>NO Zendesk channel. Generic channel grep finds no adapter.</td>
<td>LOW unless support is a target vertical</td>
<td>M</td>
</tr>
<tr>
<td>60. Salesforce Marketing Cloud verified event batches</td>
<td>Flue 2.0.3</td>
<td>Separates controlled unsigned setup from recurring exact-body HMAC, validates ordered nonempty batches up to 1,000 while retaining raw verified bytes, accepts only 200–204 acknowledgements, and documents at-least-once retry for up to seven days. <small>Source: <code>ecosystem/channels/salesforce-marketing-cloud.md:333-408</code>.</small></td>
<td>NO SFMC channel. <code>git grep -i -n -E 'Salesforce Marketing Cloud|SFMC|event batch.*1000' origin/main -- packages plugins</code> → no matches.</td>
<td>LOW — they have it; we do not need it</td>
<td>M–L</td>
</tr>
<tr>
<td>61. Photon/iMessage agent channel</td>
<td>eve 0.31.3</td>
<td>Adds iMessage delivery through the Photon channel alongside Eve's standard durable session and channel projection machinery. <small>Source: eve tag <code>docs/channels/photon.mdx</code>.</small></td>
<td>NO channel equivalent. <code>git grep -i -l -E 'Photon|iMessage' origin/main -- packages plugins</code> → only ordinary words such as Pi “message,” no Photon/iMessage integration.</td>
<td>LOW — niche and platform-specific</td>
<td>M–L</td>
</tr>
<tr>
<td>62. Vue and Svelte agent state hooks</td>
<td>eve 0.31.3</td>
<td>Offers the same session/stream/error/composer/HITL/event reducer surface across React, Vue, and Svelte instead of requiring each frontend ecosystem to reimplement the client state machine. <small>Source: eve tag <code>docs/guides/frontend/overview.mdx</code>.</small></td>
<td>NO Vue/Svelte client surface; boring-ui is React-first. <code>git grep -i -l -E 'useEveAgent|Vue.*agent|Svelte.*agent|Nuxt|SvelteKit' origin/main -- packages plugins</code> → no matches.</td>
<td>LOW — they have it; our product does not need framework neutrality today</td>
<td>XL to support well</td>
</tr>
<tr>
<td>63. Turnkey same-origin Next.js, Nuxt, and SvelteKit hosting integrations</td>
<td>eve 0.31.3</td>
<td>Co-locates agent and application routes in one dev server/deploy, avoids CORS/host-env synchronization, and supports multiple named Next.js agents/routes. <small>Source: eve tag <code>docs/guides/frontend/{nextjs,nuxt,sveltekit}.mdx</code>.</small></td>
<td>NO framework adapters. <code>git grep -i -n -E '\bwithEve\b|\bNuxt\b|\bSvelteKit\b|Next\.js agent route' origin/main -- packages plugins</code> → no matches.</td>
<td>LOW–MED — useful only if boring-agent becomes an embeddable framework</td>
<td>L–XL</td>
</tr>
<tr>
<td>64. Durable sleep/polling tool</td>
<td>eve 0.31.3</td>
<td>An opt-in model tool pauses a turn before polling without holding the application runtime. It is a time-based workflow primitive, distinct from the already-listed durable human-input pause. <small>Source: eve tag changelog 0.29.0.</small></td>
<td>NO durable sleep primitive. <code>git grep -i -l -E 'durable sleep|sleep tool|pause.*polling' origin/main -- packages plugins</code> → no matches.</td>
<td>LOW–MED</td>
<td>M</td>
</tr>
<tr>
<td>65. Terminal-aware trace viewer theme adaptation</td>
<td>eve 0.31.3</td>
<td>Probes terminal background and derives legible light/dark trace cards with a safe fallback theme. This is the only theme-like long-tail item found; neither Eve nor Flue has a general shipped UI i18n/accessibility/theming system. <small>Source: eve tag changelog 0.29.4.</small></td>
<td>NO terminal trace viewer, so no equivalent adaptation. Our web UI already has real theming/accessibility and is stronger in that domain. <code>git grep -i -l -E 'terminal background|terminal.*theme|trace card.*theme' origin/main -- packages plugins</code> → no matches.</td>
<td>LOW — do not build independently</td>
<td>S</td>
</tr>
</tbody>
</table>

## The five I would actually build

1. **Native eval DSL + deterministic model + judges/reporters (row 1).**
   Our eval kernel is already real, so this is leverage rather than a rewrite.
   Add a deterministic prompt/tool mock first, then trajectory/order assertions,
   then JUnit/JSON and optional judge calls. It turns behavioral regressions into
   reviewable evidence and makes remote/deployed parity testable.

2. **Per-session token ceilings (row 2).**
   This is a small, sharp safety primitive that our sophisticated currency
   budgets do not replace. A runaway individual session should stop locally
   before it can consume a user's broader budget. Use separate root/subagent
   defaults and surface the terminal reason through the existing stable-error
   and metering paths.

3. **Immutable attachment storage (row 3).**
   We already have the user-facing upload/composer path; the missing integrity,
   idempotency, immutable identity, scoped serving, and oversized-value behavior
   is exactly the kind of operational tail that becomes painful later. Build the
   narrow store/route contract and reuse workspace storage behind it initially.

4. **Resolved capability diagnostics: <code>agent info --json</code> plus stable artifacts (rows 11 and 16).**
   Boring-ui's composition is now rich enough that operators need to answer
   “what will this agent actually have?” without booting a chat and reverse-
   engineering logs. This is relatively cheap, directly improves error quality,
   and gives tests/deploy tooling a stable inspection surface.

5. **A verified inbound-channel SPI, then Slack and GitHub only (rows 5, 44, 45).**
   Build the common security/identity/delivery boundary once: exact-byte verify,
   canonical conversation address, trusted outbound destination binding, hidden
   callback capabilities, ack/deadline metadata, and an application-owned
   dedupe seam. Slack gives the strongest conversational UX; GitHub fits our
   existing product. Do not chase the remaining provider matrix until demand.

I would not build the database, sandbox-provider, deployment-target, or long-tail
channel matrices speculatively. They are genuine gaps, and Flue/Eve deserve
credit for having them, but our existing Postgres/SQLite, runsc/Vercel, Docker,
and React stack is sufficient until a concrete customer or deployment target
forces the maintenance cost.
