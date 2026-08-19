# Prompt and context engineering harvest
## Executive findings
1. **OpenCode has the best project-instruction retrieval model.** It loads global and project instructions in the fixed system prompt, then discovers nested `AGENTS.md`/`CLAUDE.md`/`CONTEXT.md` files when work enters a subdirectory. PI only loads one winning filename per ancestor at startup. Flue 2.0.3 reads only `cwd/AGENTS.md` and `cwd/CLAUDE.md`. Eve does not treat `AGENTS.md` specially at all.
2. **Eve has the cleanest authored prompt contract.** `instructions.md` is the system prompt, with deterministic fragment ordering and no framework persona or workspace dump. This is excellent for quality ownership and cache stability, but unsuitable as a drop-in coding-agent default unless the author supplies the missing coding behavior.
3. **PI's default fixed prompt is the largest and least product-specific.** It includes a framework persona, a duplicated tool catalog, guidelines, and a large block pointing to PI's own README/docs/examples. In Boring UI, a regression test permits 36,000 characters and says the baseline is about 34,000 characters. That is roughly 8,500 tokens before provider-native tool schemas and conversation history.
4. **Boring UI is using `@mariozechner/pi-coding-agent`'s `AgentSession`, not the newer `@earendil-works/pi-agent-core` `AgentHarness`.** The relevant prompt owner is therefore PI Coding Agent's `core/system-prompt.js`. Upgrading PI Core alone will not change the active prompt.
5. **Boring UI duplicates custom-tool prose.** `tool-adapter.ts` passes the full `description` to the provider-native tool definition and defaults `promptSnippet` to the same description. PI then repeats that snippet in `Available tools`. This is a cheap, high-confidence cost reduction.
6. **OpenCode is the only reference that prunes old tool results before full summarisation.** It protects the newest 40,000 estimated tool-output tokens and the `skill` tool, and only commits pruning when it saves more than 20,000 tokens. PI and Flue merely clip each tool result to 2,000 characters in the *summary request*; the active transcript remains large until compaction.
7. **PI and Flue use essentially the same compaction lineage.** Both use provider-reported usage plus a `chars / 4` tail estimate, clip summary-input tool results to 2,000 characters, preserve exact file operations, support split-turn summaries, and expose visible compaction events. Their important difference is defaults: PI reserves 16,384 and keeps 20,000 recent tokens; Flue reserves up to 20,000 and keeps 8,000.
8. **Eve uses a threshold percentage, not a fixed reserve.** Its default is 90% of the context window and it adds the fixed checkpoint-prompt envelope before comparing. It updates the prior checkpoint intact, restores durable todo state, and resets read-before-write evidence after compaction.
9. **OpenCode's current implementation now combines two context reducers.** The legacy/session path keeps two recent turns under a computed 2,000–8,000-token tail budget. Its v2 core path uses a 20,000-token buffer and keeps 8,000 tokens. Both serialize tool results at at most 2,000 characters for summary generation.
10. **Prompt caching is implemented at provider adapters, but prompt ordering still matters.** Flue explicitly freezes a stable prefix. Eve compiles static instructions and warns that model switching destroys cache reuse. OpenCode installs cache breakpoints on up to the first two system messages and last two non-system messages, yet its environment (including today's date) precedes project instructions and skills. PI marks the system prompt cacheable for Anthropic and supplies an OpenAI `prompt_cache_key`, but Boring UI can dynamically rewrite its prompt every turn.
11. **The best cheap harvest is host-owned prompt composition.** PI already exposes `customPrompt`, `appendSystemPrompt`, `promptGuidelines`, `toolSnippets`, and resource-loader controls. We can replace the bloated default without forking PI. The one improvement that cannot be configured cleanly is OpenCode-style nested instruction injection; that needs a host extension/resource-loader change or taking ownership of prompt assembly.
12. **The best quality harvest is a deliberate stable-prefix layout:** product behavior first; stable project instructions next; compact capability catalogs next; volatile environment last; per-turn/nested updates outside the cached prefix.
## Scope, versions, and confidence
| Subject | Exact evidence used | Confidence / caveat |
|---|---|---|
| Flue | Installed `@flue/runtime@2.0.3` compiled source plus offline CLI docs | Exact version |
| Eve | Official GitHub tag `eve@0.31.3` docs and source-linked changelog | Exact docs; a few internal assembly details are inferred from the documented AI SDK contract and are labelled |
| OpenCode | Official `dev` v2 source and v2 core source | Exact inspected source snapshot, not a numbered release tarball |
| PI | Shipped symlink targets for `@mariozechner/pi-coding-agent@0.80.7`, `@earendil-works/pi-agent-core@0.80.7`, and `@earendil-works/pi-ai` | Exact installed artifacts |
| Boring UI | Local `packages/agent/src/server/harness/pi-coding-agent/*`, MCP delegate code, and tests | Exact workspace state |
The OpenCode repository is in a v2 transition and contains both the established session implementation and a newer `packages/core` session implementation. This report identifies both where their behavior differs.
No claim below uses the already-known Flue freeze/signal/skill facts as a discovery; those facts appear only where needed for comparison.
## 1. System prompt anatomy
### Side-by-side order
| Order | Flue 2.0.3 | Eve 0.31.3 | OpenCode v2/current | PI Coding Agent 0.80.7 / ours |
|---:|---|---|---|---|
| 1 | Authored `instructions` | Authored root `instructions` | Model-family prompt, or custom agent prompt | PI persona, unless `customPrompt` replaces default |
| 2 | `AGENTS.md` then `CLAUDE.md` from cwd | Static/dynamic extension instructions compose with root instructions | Environment block | Available-tools prose catalog |
| 3 | Skill catalog | No always-on skill bodies; `load_skill` is a conditional tool | Global/project instruction files | Guidelines derived from selected tools |
| 4 | Subagent catalog | Tool definitions are provider-native | MCP server instructions | PI self-documentation paths and usage notes |
| 5 | Date | Provider-native tools | Verbose skill catalog | Host `appendSystemPrompt` |
| 6 | Working directory | Conversation/checkpoint context | Structured-output rule if requested | `<project_context>` global + ancestor files |
| 7 | Direct-child directory names | — | Per-user system override | `<skills>` catalog |
| 8 | — | — | Provider-native tool definitions | Current working directory |
### Why the orders matter
| Framework | Design intent | Practical consequence |
|---|---|---|
| Flue | Stable, load-bearing init snapshot; volatile changes arrive later as events | Strong cache reuse and deterministic identity, but stale environment must be narrated correctly |
| Eve | The author owns identity; capabilities live in tools and skills | Minimal hidden policy and little fixed-prefix waste; quality depends heavily on authored instructions |
| OpenCode | Model-specific coding policy first, then operating context and scoped knowledge | Better model specialization and local-rule fidelity; environment-before-instructions is cache-suboptimal |
| PI | General-purpose coding CLI that teaches the model how PI itself works | Good standalone discoverability; poor fit for an embedded product whose users never need PI's own docs |
### Flue: exact assembly
The installed 2.0.3 bundle's effective assembly is:
```ts
if (instructions) pushSection(instructions);
if (agentsMd) pushSection(agentsMd);
if (catalog.length > 0) {
  pushSection("## Available Skills", ...catalog);
}
if (agentCatalog.length > 0) {
  pushSection("## Available Agents", ...agentCatalog);
} else {
  pushSection("## Available Agents", "", "None...");
}
pushSection(`Date: ${new Date().toISOString().slice(0, 10)}`);
parts.push(`Working directory: ${env.cwd}`);
parts.push(`Directory structure:\n${entries.join("\n")}`);
```
Notable details:
- There is no mandatory Flue persona ahead of authored instructions.
- Author intent receives maximum primacy.
- The empty subagent section still costs tokens.
- Date and environment are deliberately at the tail of the frozen prefix.
- Tools are provider-native; Flue does not repeat every tool schema in prose.
### Eve: exact authored contract
The tag documentation is unusually literal:
> “Instructions are the always-on system prompt … eve prepends the instructions to every model call in the session.”
And:
> “Whatever you write is the prompt.”
Composition rules are deterministic:
```text
agent/instructions.md or instructions.ts
then
agent/instructions/*.{md,ts}, non-recursive, localeCompare filename order
then
extension instruction contributions
then
runtime dynamic instruction contributions for the active scope
```
Important distinctions:
- A `.ts` static instruction module executes once at build time.
- Its resolved Markdown is captured in the compiled manifest.
- Dynamic instructions can resolve at session, turn, or step scope.
- Runtime refresh is therefore explicit author policy, not implicit filesystem discovery.
- Eve's built-in tools are advertised only when available to that session.
- The model gets native tool definitions; there is no second general tool catalog in the authored prompt.
Eve's order is best understood as **identity first, callable capability beside it, history after it**.
### OpenCode: the actual prompt-building prize
The outer session assembly is:
```ts
const [skills, env, instructions, mcpInstructions, modelMsgs] = await all([
  sys.skills(agent),
  sys.environment(model),
  instruction.system(),
  sys.mcp(agent, session.permission),
  MessageV2.toModelMessagesEffect(msgs, model),
]);
const system = [
  ...env,
  ...instructions,
  ...(mcpInstructions ? [mcpInstructions] : []),
  ...(skills ? [skills] : []),
];
```
The request layer then prefixes the model-family prompt:
```ts
const system = [[
  ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
  ...input.system,
  ...(input.user.system ? [input.user.system] : []),
].filter(Boolean).join("\n")];
```
Therefore the true order is:
1. Agent-specific prompt, if configured; otherwise model-family prompt.
2. Environment.
3. Global/project instructions.
4. MCP server-authored instructions.
5. Skill catalog.
6. Structured-output enforcement, when applicable.
7. Per-user-message system override.
8. Provider-native tool definitions as a separate request field.
`SystemPrompt.provider(model)` chooses among dedicated templates:
```ts
if (id.includes("gpt-4") || id.includes("o1") || id.includes("o3")) return [PROMPT_BEAST];
if (id.includes("gpt") && id.includes("codex")) return [PROMPT_CODEX];
if (id.includes("gpt")) return [PROMPT_GPT];
if (id.includes("gemini-")) return [PROMPT_GEMINI];
if (id.includes("claude")) return [PROMPT_ANTHROPIC];
return [PROMPT_DEFAULT];
```
This is a material quality advantage over one universal coding prompt: instructions can account for family-specific tool-use and reasoning behavior.
The order is not cache-optimal. Environment includes a daily-changing date and precedes more stable instructions and skills. An official issue proposes reversing this; it is not the current behavior.
### PI Coding Agent: exact active assembly
The installed `buildSystemPrompt()` builds:
```text
You are an expert coding assistant operating inside pi...
Available tools:
- read: <promptSnippet>
- bash: <promptSnippet>
- edit: <promptSnippet>
- ...custom tools
Guidelines:
- tool-dependent operational guidance
- Be concise.
- Show file paths.
Pi documentation:
- absolute path to README
- absolute path to docs
- absolute path to examples
- instructions for extending/configuring Pi
<appendSystemPrompt supplied by Boring UI>
<project_context>
Contents of /global/AGENTS.md...
Contents of /ancestor/AGENTS.md...
Contents of /cwd/AGENTS.md...
</project_context>
<skills>
  <skill><name>...</name><description>...</description><location>...</location></skill>
</skills>
Current working directory: ...
```
If `customPrompt` is supplied, it replaces the persona, available-tools prose, guidelines, and PI documentation block. PI still appends host prompt text, project context, skills, and cwd.
This is the key configuration seam for Boring UI.
### Boring UI's actual wiring
`createHarness.ts` calls `createAgentSession(...)` with:
- `cwd: runtimeCwd`;
- PI builtin tools disabled in favor of Boring's adapted tools;
- Boring's selected model;
- a `DefaultResourceLoader` rooted at the storage cwd;
- an extension that can modify `before_agent_start` prompt state;
- a Boring append block containing workspace/path guidance.
It does **not** instantiate PI Core's newer `AgentHarness`.
Consequences:
- PI Coding Agent owns default prompt composition.
- PI Core prompt changes do not automatically reach us.
- `customPrompt` is available without forking.
- `appendSystemPrompt` is available without forking.
- Per-turn extension rewrites are available, but can destabilize cache keys.
## 2. Environment description
### Side-by-side
| Dimension | Flue 2.0.3 | Eve 0.31.3 | OpenCode v2/current | PI / ours |
|---|---|---|---|---|
| CWD | Yes | Not framework-added by the authored prompt contract | Yes | Yes |
| Workspace root | No separate root | Sandbox is a capability, not dumped prompt text | Yes | No separate root |
| Directory listing | Direct children, names only | None automatically | None automatically | None automatically |
| Listing depth | 1 | 0 | 0 | 0 |
| File count | No | No | No | No |
| Git repo flag | No | No | Yes/no | No |
| Git status/diff | No | No | No | No |
| OS/platform | No | No | `process.platform` | No |
| Date | ISO day | Only if author adds it | Current date | No default date |
| Toolchain versions | No | No | No | No |
| Explicit size budget | None | Author-owned | None | None; Boring test caps whole prompt at 36,000 chars |
### Interpretation
Flue's direct-child listing is a cheap orientation hint, but it becomes noisy in monorepos and is frozen even if files change.
OpenCode chooses facts that are difficult for the model to infer without a tool call: cwd, workspace root, repository flag, platform, and date. It omits listings because `glob`/`read` can retrieve fresh structure.
Eve is the most austere. The sandbox and file tools define what the agent can observe. No workspace census is paid on every call.
PI's lack of a listing is reasonable, but its saved tokens are overwhelmed by PI self-documentation.
### Environment budgets
No framework except Boring's own regression test sets a hard byte/token budget on the complete environment/system prompt.
Known concrete numbers:
- Boring system-prompt regression ceiling: **36,000 characters**.
- Commented Boring baseline: approximately **34,000 characters**.
- Approximate baseline at PI's own estimator: **8,500 tokens**.
- Flue directory listing: unbounded number of direct child names.
- OpenCode project references: unbounded number of entries with name, path, and description.
- Eve authored instructions: unbounded by the framework.
Recommendation: budget each subsection, not merely the final concatenated prompt.
Suggested budgets for us:
| Section | Proposed cap | Overflow behavior |
|---|---:|---|
| Product behavior | 4,000 tokens | Build failure |
| Project/root instructions | 4,000 tokens | Warn and truncate only explicitly low-priority sources |
| Skill catalog | 1,500 tokens | Rank/scope, then omit |
| Tool prose catalog | 500 tokens | One short capability line per non-obvious tool |
| Environment | 500 tokens | Omit listing first |
| Dynamic per-turn signals | 1,000 tokens | Coalesce by identity |
## 3. Project instruction handling
### Discovery and precedence
| Framework | Discovery | Ordering / precedence | Size limit | Conflict behavior |
|---|---|---|---:|---|
| Flue | Exactly `cwd/AGENTS.md`, then `cwd/CLAUDE.md` | Both concatenate in that order | None | No explicit rule; later CLAUDE text has recency but no semantic precedence |
| Eve | No special `AGENTS.md`; authored `instructions*` under the agent/extension root | Root flat file, then directory fragments alphabetically; dynamic scopes resolve at runtime | None | Author controls order; invalid dual root `.md` + `.ts` is a build error |
| OpenCode | Global config instruction, project walk-up, configured globs/URLs; nested discovery per touched path | Global → project hierarchy → configured; nested files injected when relevant | None | No formal conflict solver; more-local/later text normally wins attention |
| PI | Global agent-dir first; then first matching filename at every ancestor from filesystem root to cwd | Global → rootmost ancestor → ... → cwd | None | No explicit conflict rule; local is later |
### Flue details
The 2.0.3 source does not walk parents.
It attempts:
```ts
readFile(join(cwd, "AGENTS.md"));
readFile(join(cwd, "CLAUDE.md"));
return contents.filter(Boolean).join("\n\n");
```
Implications:
- A worker launched from a subdirectory can miss repository-root policy.
- A worker launched at repo root cannot acquire package-local policy later.
- Both files are accepted simultaneously.
- There is no byte cap or diagnostic for oversized files.
### Eve details
Eve replaces implicit repository convention with explicit agent authoring:
- `agent/instructions.md` or `agent/instructions.ts`.
- Both at the root is a build error.
- `agent/instructions/` is non-recursive.
- `.md` and `.ts` fragments sort with `localeCompare`.
- Root flat content comes before directory fragments.
- Static TypeScript resolves at build time.
- `defineDynamic` resolves from session/turn/step context.
- Declared subagents discover only their own authored slots.
This provides deterministic precedence but does not ingest an arbitrary checked-out repository's `AGENTS.md` automatically.
### OpenCode details
Global sources include:
- `$XDG_CONFIG_HOME/opencode/AGENTS.md`;
- fallback `~/.claude/CLAUDE.md` where applicable.
Project candidates include:
- `AGENTS.md`;
- `CLAUDE.md`;
- deprecated `CONTEXT.md`.
Configured `instructions` entries may be:
- absolute files;
- relative globs;
- remote URLs.
The distinctive mechanism is `Instruction.resolve(messages, filepath, messageID)`:
- Start at the referenced file's directory.
- Walk upward toward the session/worktree root.
- Find nearby instruction files not already in the system prompt.
- Avoid re-injecting the same instruction for the assistant message.
- Add it as synthetic context associated with the file operation.
This is materially better than eager-loading every nested instruction file.
It gives local rules exactly when code under that subtree enters scope.
### PI details
`DefaultResourceLoader` considers these candidate names per directory:
```text
AGENTS.md
AGENTS.MD
CLAUDE.md
CLAUDE.MD
```
Only the first existing candidate in a directory is loaded, so `AGENTS.md` wins over `CLAUDE.md`.
Discovery does:
1. First matching file in PI's global agent directory.
2. First matching file in each ancestor from filesystem root to cwd.
3. Deduplicate resolved paths.
4. Emit path-labelled contents in `<project_context>`.
It does not:
- discover instructions beneath cwd;
- attach rules based on the file currently being read/edited;
- enforce a byte/token limit;
- state a formal conflict precedence to the model.
### What ours should adopt
Cheap now:
- Keep ancestor loading.
- Add an explicit sentence: “When instructions conflict, the closest file to the target path wins; user instructions still outrank repository instructions.”
- Warn on total instruction bytes.
Medium effort:
- Add OpenCode-style nested resolution before/after file-tool calls.
- Cache parsed instruction files by path + mtime/hash.
- Inject once per model step as a synthetic update, not by rebuilding the fixed prefix.
## 4. Tool descriptions and schemas
### Side-by-side
| Framework | Prompt prose | Provider schema | Examples | Budget |
|---|---|---|---|---:|
| Flue | No general duplicate catalog; skill/subagent catalogs only | Normal full tool schema | Only where authored | None for schemas |
| Eve | No universal duplicate catalog; conditional tools only | AI SDK native schema + description | Author-controlled | None documented |
| OpenCode direct mode | No prose list of every tool | Full native definitions, sorted | Tool description files may include examples | None in direct mode |
| OpenCode Code Mode | One `execute` schema plus TS-looking catalog | MCP schemas stay host-resident | Catalog instructions include search/call workflow | **2,000 estimated tokens** default for inline signatures |
| PI | `Available tools` repeats `promptSnippet` | Full native schema + description | Schema descriptions/examples/defaults preserved | None |
### Flue
Flue's built-ins have concise descriptions and TypeBox/JSON Schema definitions.
Output limits are concrete:
- `read`: 2,000 lines or 50 KB, head-preserving.
- `bash`: 2,000 lines or 50 KB, tail-preserving.
- `grep`: 100 matches, with line clipping.
- `glob`: 1,000 results.
These are result budgets, not schema budgets.
The detached-task description is concise and tells the model the child has its own context.
### Eve
`defineTool()` gives the model:
- slug/name;
- description;
- input schema;
- output rendering via `toModelOutput` where authored.
Conditional surface reduction is strong:
- `agent` exists only in root sessions.
- `load_skill` exists only if skills exist.
- `connection_search` exists only if connections exist.
- `ask_question` exists only if human input is possible.
- `web_search` exists only for supporting providers/configurations.
This saves both schema tokens and erroneous-call risk.
Eve does not document a schema trimming pass or total schema budget.
### OpenCode
Direct mode sends full tool schemas through the AI SDK.
The request layer sorts tool names lexically for deterministic requests:
```ts
tools: Object.fromEntries(Object.entries(tools).toSorted(([a], [b]) => a.localeCompare(b)))
```
For OpenAI/Azure/Mantle it forces `strict: false` so dynamic/MCP schemas register even when not structured-output-compatible.
The optional Code Mode path is the strongest catalog-cost reference:
- One outer `execute` tool is provider-native.
- Full MCP definitions remain in host memory.
- A TypeScript-looking catalog exposes namespace summaries and selected signatures.
- The initial complete-signature budget is 2,000 tokens estimated at chars/4.
- Omitted tools are found with host-side lexical search.
- Search returns full signatures; it does not mutate the provider tool list.
This is valuable for very large connector catalogs but is more machinery than needed for ordinary coding tools.
### PI and Boring UI
PI tool definitions have both:
- `description`: provider-native prose;
- `promptSnippet`: a one-line entry in `Available tools`.
Boring's adapter currently defaults:
```ts
promptSnippet: tool.promptSnippet ?? tool.description
```
Therefore a long custom description is duplicated verbatim.
Schemas are not trimmed:
- property descriptions survive;
- examples survive;
- defaults survive;
- nested alternatives survive;
- provider-native JSON Schema cost is outside Boring's 36,000-character system-prompt test.
This creates a blind spot: the regression test measures only text, not the complete request.
### Immediate tool-cost fix
For every Boring tool, require a distinct `promptSnippet` of at most roughly 80 characters.
Then decide whether the prose catalog is needed at all under a custom prompt.
Measure complete request tokens including serialized schemas, not just `systemPrompt.length`.
## 5. Compaction and summarisation
### Side-by-side mechanics
| Mechanic | Flue 2.0.3 | Eve 0.31.3 | OpenCode established session | PI / ours |
|---|---|---|---|---|
| Auto trigger | Usage > window − reserve | Conversation + checkpoint envelope > threshold% | Provider usage ≥ usable input | Usage > window − reserve |
| Default reserve | Up to 20,000 | 10% implicit at default 0.9 | min(20,000, max output), model-dependent | 16,384 |
| Recent verbatim | 8,000 tokens | Checkpoint + framework state; exact tail not documented as public knob | 2 turns under 2,000–8,000 tokens | 20,000 tokens |
| Tool results in summary request | 2,000 chars each | Large outputs compressed; exact internal cap not public docs | 2,000 chars each | 2,000 chars each |
| Pre-prune active history | No | No public per-tool pruning hook | Yes: protect 40k, require >20k saving | No |
| Previous summary | Updated | Passed intact and replaced | Passed intact and updated | Updated |
| Split turn | Yes | Not documented | Yes, at message boundary | Yes |
| File operations | Explicit lists | Read/write state reset safely | Relevant-file section | Explicit lists |
| Visible event | Yes | `compaction.requested/completed` | Stored summary message/events | `compaction_start/end` |
### Flue summary prompt
System instruction:
```text
You are a context summarization assistant. Your task is to read a
conversation between a user and an AI assistant, then produce a structured
summary following the exact format specified.
Do NOT continue the conversation. Do NOT respond to any questions in the
conversation. ONLY output the structured summary.
```
Required sections:
```text
## Goal
## Constraints & Preferences
## Progress
### Done
### In Progress
### Blocked
## Key Decisions
## Next Steps
## Critical Context
```
The serializer retains:
- user text;
- assistant text;
- assistant reasoning;
- tool calls and arguments;
- up to 2,000 characters per tool result;
- exact read/modified file lists appended outside model inference.
Summary output allowance is `min(0.8 * reserve, 16,000)`.
Split-prefix output allowance is `min(0.5 * reserve, 16,000)`.
### Eve checkpoint prompt
The exact 0.31.3 docs specify that the checkpoint must retain:
- completed progress;
- decisions;
- remaining work;
- constraints and preferences;
- data and references needed to continue.
The implementation lineage added in 0.24.2 also guarantees:
- fixed checkpoint prompt envelope counted before threshold;
- previous checkpoint passed intact;
- completed versus remaining work explicitly separated.
Eve preserves framework state beyond prose:
- active todo list is re-injected;
- read-before-write state is reset so stale read evidence cannot authorize a later write;
- compaction can be requested manually between turns;
- `clear()` discards model history but preserves session identity, tools, skills, state, limits, and sandbox.
This is a quality/safety advantage over treating compaction as only text summarisation.
### OpenCode summary prompt
Current v2 core template:
```text
## Objective
- [what the user is trying to accomplish]
## Important Details
- [constraints/preferences, decisions and why, facts/assumptions, exact context]
## Work State
### Completed
### Active
### Blocked
## Next Move
1. [immediate concrete action]
2. [next action]
## Relevant Files
- [path: why it matters]
```
Rules include:
```text
Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers.
Do not mention the summary process or that context was compacted.
```
The established session path:
- keeps up to two recent user turns;
- computes a tail budget as 25% of usable context, clamped to 2,000–8,000 tokens;
- can split a turn at a message boundary;
- excludes old completed compaction messages from the next summary input;
- clips tool output at 2,000 characters;
- keeps skill output exempt from pre-pruning;
- replays the overflowing user message after removing oversized media.
The v2 core path:
- reserves 20,000 tokens by default;
- keeps 8,000 serialized recent tokens;
- uses a 4,096-token summary cap;
- checks the complete estimated request: system + messages + tools;
- emits durable compaction started/ended events;
- stores both summary and recent serialized context.
### PI summary prompt and persistence
PI's prompt is effectively the Flue lineage with the same structured headings.
Defaults:
```json
{
  "enabled": true,
  "reserveTokens": 16384,
  "keepRecentTokens": 20000
}
```
Persistence:
- raw history remains append-only in JSONL;
- a compaction entry stores summary, first kept entry id, tokens before, optional details, and hook provenance;
- replay projects a synthetic compaction-summary message plus retained entries;
- UI/event consumers see start/end reason (`manual`, `threshold`, `overflow`).
Hooks can cancel or replace native compaction and branch summaries.
Boring UI currently does not expose these knobs through `createHarness()`.
## 6. Context-window accounting and overflow
### Side-by-side
| Framework | Primary count | Estimate fallback | Reserve/output treatment | Overflow behavior |
|---|---|---|---|---|
| Flue | Last valid assistant provider usage | Subsequent content at chars/4; images ≈1,200 tokens | Model-aware reserve capped 20k | Compact and retry once; fail clearly if still too large |
| Eve | AI SDK/provider usage plus fixed checkpoint envelope | Framework estimator for trigger | Default 90% threshold; configurable model/window | Compact before next call; session token budgets stop subsequent calls |
| OpenCode established | Last assistant `total` or input+output+cache | Serialised messages at chars/4 for tail selection | `inputLimit-reserved` or `context-maxOutput` | Compact; on media overflow, strip/replay; stop if compact request itself overflows |
| OpenCode v2 core | Complete JSON request estimate | chars/4 | max(output allowance, 20k buffer) | Compact before call; compact-after-overflow fallback |
| PI | Last valid assistant provider usage | Subsequent content at chars/4; images ≈1,200 tokens | 16,384 default reserve | One compact+retry on provider overflow; explicit error on repeated overflow |
### Flue reserve formula
Conceptually:
```ts
reserve = min(20_000, model.maxTokens > 0 ? model.maxTokens : 20_000);
if (reserve * 2 >= contextWindow) {
  reserve = max(1_024, floor(contextWindow / 3));
}
trigger = contextTokens > contextWindow - reserve;
```
This behaves sanely on small windows and avoids reserving half or more of context.
### PI estimator
PI finds the newest valid assistant usage record.
It uses `totalTokens` when valid; otherwise:
```text
input + output + cacheRead + cacheWrite
```
Messages after that usage point are estimated.
Text is approximately `characters / 4`.
An image placeholder contributes 4,800 estimated characters, or about 1,200 tokens.
This is cheap and monotonic, but provider tool-schema/system-prompt changes between calls are not directly represented by the trailing-message estimator.
### Eve session-wide limits
Separate from context overflow, Eve supports:
- `maxInputTokensPerSession`;
- `maxOutputTokensPerSession`;
- a default root input budget of 40,000,000 provider-reported tokens;
- no default output budget;
- a durable approval/stop continuation prompt after a call crosses budget;
- delegated children receiving a split of the parent's remaining quota.
This is spend governance, not context compaction.
PI/Boring currently has no equivalent framework-owned session quota in the active harness.
### Mid-turn overflow comparison
Flue and PI:
- Detect explicit provider context-overflow errors.
- Compact once.
- Retry the interrupted user turn once.
- Refuse an infinite compact/retry loop.
OpenCode:
- Converts the failure into an explicit compaction message.
- Can remove media attachments from the replayed request.
- If the summary request itself cannot fit, stores a context-overflow error and stops.
- Otherwise inserts a synthetic “continue or ask” message.
Eve:
- Compacts proactively at the configured percentage plus checkpoint envelope.
- Exact provider-overflow retry behavior is less explicit in public docs than the proactive path.
- Dynamic model selection must supply the correct context-window override; it is not inherited from fallback.
## 7. Prompt caching
### Side-by-side
| Framework | Cache mechanism | Stable-prefix strategy | Main invalidators |
|---|---|---|---|
| Flue | Provider caching plus frozen init prompt | Explicitly freezes prompt and uses append-only signals | Rebaseline, model/tool/schema change, new session |
| Eve | Provider/AI Gateway prompt caching | Static instructions compiled once; prefer session-scoped model selection | Dynamic instructions, step/turn model switch, tool-set change |
| OpenCode | Cache-control markers on first 2 system + last 2 non-system messages | Deterministic tool sort; no stable-first ordering of all prompt sections | Daily date, cwd/root, instructions, skills, tools, plugin transforms |
| PI | Anthropic cache control; OpenAI prompt cache key from session id; provider-specific variants | System prompt marked cacheable, but no explicit frozen prompt architecture | Resource reload, tool change, dynamic extension rewrite, cwd, skill catalog |
### PI provider behavior
Installed PI AI behavior includes:
- Anthropic `cacheRetention` defaults to `short` unless long retention is selected/environment-configured.
- The system prompt receives cache control.
- Recent message breakpoints are also marked where supported.
- OpenAI Responses receives a `prompt_cache_key` derived from the session id unless caching is disabled.
- Long retention maps to provider-supported extended retention where available.
- Bedrock uses cache points.
This means caching exists, but the *content identity* still controls hits.
Boring's `before_agent_start` extension can rewrite the system prompt each turn.
Any volatile value placed before the reusable prefix invalidates everything after it.
### OpenCode provider behavior
`applyCaching()` selects:
```ts
const system = msgs.filter(m => m.role === "system").slice(0, 2);
const final = msgs.filter(m => m.role !== "system").slice(-2);
for (const msg of unique([...system, ...final])) addCacheControl(msg);
```
Supported annotations include:
- Anthropic ephemeral cache control;
- OpenRouter cache control;
- Bedrock cache points;
- OpenAI-compatible cache control;
- Copilot cache control;
- Alibaba cache control.
Deterministic lexical tool sorting is cache-friendly.
But the current prompt order is not:
```text
model prompt → environment (date/cwd) → instructions → MCP → skills
```
The stable-prefix improvement is obvious:
```text
model prompt → stable instructions → stable skills/tool catalogs → environment → dynamic updates
```
### Eve cache guidance
Eve explicitly warns that model switches re-ingest conversation at uncached prices.
Its dynamic model precedence is:
```text
step > turn > session > fallback
```
The docs recommend session scope for cache reuse.
Static instruction modules resolve at build time and are captured, which gives stable bytes across sessions within a deployment.
### Proposed stable-prefix contract for ours
```text
1. Product behavioral prompt (versioned constant)
2. Stable root/ancestor project instructions (content-hashed)
3. Stable, compact skill catalog (sorted)
4. Stable, compact tool capability catalog (sorted)
5. Volatile environment facts
6. Per-turn local instruction updates and capability changes as synthetic messages
7. Conversation
```
Do not include:
- current date unless the task requires it;
- full directory listing;
- absolute PI installation documentation paths;
- dynamic usage/quota values in the fixed prefix;
- complete tool descriptions twice.
## 8. Subagent and child context
### Side-by-side
| Framework | Conversation | Instructions | Tools/skills | Workspace/state | Result returned |
|---|---|---|---|---|---|
| Flue detached task | Fresh | Child's own; parent prompt not inherited | Child's own catalogs | Same workspace/sandbox class; separate state | Final answer only |
| Eve built-in `agent` child | Fresh | Copy of root instructions | Root tools, connections, auth, hooks/extensions; no `agent`/Workflow | Shared sandbox; fresh state | Tool result |
| Eve declared subagent | Fresh | Own optional instructions; inherits nothing authored | Own slots only | Own/default sandbox and state | Tool result |
| OpenCode task child | Fresh session with `parentID` | Rebuilt for selected agent; project instructions rediscovered | Selected subagent permissions/tools | Same cwd/worktree; separate session | Task output + attachments |
| PI core/coding-agent | No native opinionated task tool in active session | Host-defined | Host-defined | Host-defined | Host-defined |
| Boring managed delegate | Fresh Boring agent session from supplied brief | Rebuilt through normal Boring harness | Normal delegated actor/workspace configuration | Bound workspace; fresh session | Bounded text or artifact |
### Flue
The child does not inherit:
- parent conversation;
- parent instruction string;
- parent tool list;
- parent skill catalog;
- parent subagent catalog;
- parent agent state.
It does inherit operational context such as workspace/sandbox environment and defaults to the parent's model/thinking configuration unless overridden.
Delegation depth is capped at 4.
Quality consequence: briefs must be self-contained.
### Eve
Eve distinguishes two child types.
Built-in `agent`:
- fresh copy of root agent;
- root instructions/tools/connections/auth/hooks/extensions;
- same sandbox;
- fresh conversation and fresh state;
- cannot recursively see `agent` or `Workflow`.
Declared subagent:
- its directory becomes an independent agent root;
- root-authored slots are not inherited;
- instructions are optional;
- own tools, connections, skills, hooks, sandbox, and nested subagents.
This explicit distinction is better than one ambiguous “inherit context” switch.
### OpenCode
The task tool creates a child session linked by `parentID`.
It supplies:
- task prompt;
- selected subagent type;
- optional model override;
- same instance cwd/worktree;
- fresh message history;
- selected agent's prompt and permissions;
- newly resolved system environment/instructions/skills.
The caller's full transcript is not copied.
The tool implementation does receive parent messages for orchestration/hooks, but the child model starts from the task prompt rather than an automatic parent-history clone.
### Boring UI
Boring's delegation is application-owned, not PI-native.
Concrete controls:
- `delegate_task` starts one fresh Boring agent session.
- Brief hard limit is **32 KiB UTF-8**.
- The delegate resolves a session context, actor, and bound runner workspace.
- Returned text/artifacts are separately bounded and validated.
- Concurrency is controller-governed.
Therefore any PI upgrade will not automatically alter child inheritance.
We own this surface already.
## PI ownership map: configuration, upgrade, or prompt ownership
| Improvement | Available now as PI config? | Plausible PI upgrade? | Requires us to own code? |
|---|---:|---:|---:|
| Replace PI persona/self-doc block | **Yes: `customPrompt`** | No need | Product prompt text only |
| Short tool snippets | **Yes: `toolSnippets` / adapter field** | No need | Small adapter policy |
| Additional product rules | **Yes: `appendSystemPrompt` / guidelines** | No need | Product prompt text |
| Reduce skill catalog fields | Partly | Maybe | Resource loader or custom prompt formatter |
| Ancestor instruction loading | Already present | — | No |
| Nested per-file instructions | No | Possible future loader feature | **Yes today** |
| Freeze/rebaseline semantics like Flue | No | Unlikely in coding-agent session | **Yes** |
| Expose reserve/keep-recent | PI settings support it, harness wiring does not | No need | Small Boring option plumbing |
| Tool-output pre-pruning | No active API | Possible future compaction feature | **Yes** or hook implementation |
| Model-family prompt variants | Custom prompt can select at session creation | Possible | Small host selector |
| Complete request token audit | No built-in textual regression | Possible telemetry | **Yes** |
| Session-wide input/output budgets | Not in active harness | Possible | **Yes** |
| Child inheritance policy | Delegation is ours | No | Already ours |
## Ranked harvest
| Rank | Change | Expected quality/cost effect | How to do it with PI owning prompt | Risk |
|---:|---|---|---|---|
| 1 | **Replace PI default with a Boring-specific `customPrompt`** | Very high cost reduction; higher behavioral precision; removes irrelevant PI docs | Pass `customPrompt` to `createAgentSession`; retain PI project context/skills/cwd tail | Medium: must preserve essential coding/tool rules |
| 2 | **Stop duplicating tool descriptions** | High recurring token saving, especially with MCP/custom tools; no capability loss | Require ≤80-char `promptSnippet`; optionally omit prose catalog from custom prompt | Low |
| 3 | **Measure full request tokens, including tool schemas** | Prevents hidden regressions; makes cost work empirical | Add a test serializer around model request construction/provider adapter | Low |
| 4 | **Add nested instruction resolution by target file** | High quality gain in monorepos; fewer irrelevant always-on rules | Extension around read/edit/write that discovers closest instructions and injects one synthetic context update per step | Medium: precedence and prompt-injection surface |
| 5 | **Expose PI compaction settings in Boring config** | Medium/high quality gain; tune 20k recent default down where wasteful | Thread `reserveTokens` and `keepRecentTokens` into session/settings creation | Low |
| 6 | **Move volatile dynamic prompt material out of the fixed prefix** | Higher cache hit rate and lower cached-input spend | Make `before_agent_start` stable; send changes as custom/synthetic messages | Medium: behavioral updates need clear identity/coalescing |
| 7 | **Adopt explicit instruction precedence text** | Reduces conflict ambiguity | Add one stable rule to custom prompt | Low |
| 8 | **Add OpenCode-style old tool-output pruning** | Major savings in research/tool-heavy sessions before lossy summary | Implement compaction hook: protect recent 40k, prune only if >20k saving, exempt skill/state tools | Medium/high: tool evidence can be lost |
| 9 | **Use model-family prompt variants** | Quality gain for tool calling/reasoning quirks | Select versioned prompt constant from model family before session construction | Medium: test matrix grows |
| 10 | **Trim skill catalog locations** | Small/medium savings; less absolute-path noise | Custom resource/catalog formatter; keep name+description and load handle | Low/medium: PI read instructions currently rely on location |
| 11 | **Add a small environment tail** | Faster initial orientation without directory dump | Append cwd, workspace root, git yes/no, platform; cap at 500 tokens | Low |
| 12 | **Remove date from stable prompt** | Small but real cross-day cache win | Do not add date; expose time through tool when needed | Low |
| 13 | **Add Eve-style durable state restoration around compaction** | Quality/safety: todos and read-before-write invariants survive | Use PI compaction hook/details plus Boring tool-state re-injection/reset | Medium |
| 14 | **Add session-wide provider-token budgets** | Spend containment, especially delegation trees | Track provider usage in Boring session/controller; gate next model call | Medium |
| 15 | **Consider Code Mode only for huge connector catalogs** | Can bound thousands of schema tokens to ~2k catalog tokens | Separate catalog/search/dispatch layer; do not fork PI prompt merely for normal coding tools | High implementation/security risk |
## Cheap, high-leverage changes
### A. Replace the default prompt
Expected immediate removal:
- PI identity/persona boilerplate not specific to Boring;
- PI README/docs/examples paths;
- instructions about configuring/extending PI;
- redundant prose for obvious tools;
- CLI-specific interaction guidance.
Minimal Boring prompt outline:
```text
You are Boring's coding agent.
Follow the user's requested scope and the repository instructions supplied below.
Inspect before editing. Preserve unrelated changes. Verify changes proportionately.
Use tools directly when they are available; do not claim a capability is unavailable
until you have checked the offered tools.
Instruction precedence:
1. User instructions.
2. Closest instruction file to the target path.
3. Repository-root instructions.
4. Global instructions.
Keep responses concise and report concrete file paths and verification results.
```
PI will still append project context, skills, and cwd after this.
### B. Separate `description` from `promptSnippet`
Policy:
```ts
promptSnippet: explicitSnippet ?? summarizeToOneLine(description, 80)
```
Better: make omission a type/test failure for production tools.
Do not silently reuse arbitrary multi-paragraph descriptions.
### C. Change the regression test
Current concept:
```text
assert(systemPrompt.length < 36_000)
```
Proposed measurements:
```text
system text estimated tokens
+ provider-native tool definitions estimated tokens
+ schema descriptions/examples/defaults estimated tokens
+ fixed synthetic messages
= fixed request footprint
```
Add section-level snapshots so a 5,000-token increase names the source.
### D. Expose compaction knobs
Start with two profiles:
| Profile | Reserve | Recent verbatim | Use case |
|---|---:|---:|---|
| Coding | 16,384 | 12,000 | Normal edits; enough exact recent tool evidence |
| Research | 20,000 | 8,000 | Long browsing/tool transcripts; rely on structured checkpoint |
PI's current 20,000 recent tokens can leave too little old material worth summarising and repeatedly carry verbose results.
Run evals before changing global defaults.
## Medium-term design
### Nested instruction resolver
Algorithm:
```text
on file target P:
  resolve P to a canonical path
  walk parent(P) upward to session root
  at each directory choose first of AGENTS.md, CLAUDE.md
  order rootmost to closest
  compare against instruction hashes already visible this model step
  inject only new/changed files as synthetic context
  state that closest path wins conflicts
```
Safety requirements:
- Stay inside authorised workspace roots.
- Do not follow instruction symlinks outside the workspace without policy.
- Cap bytes per file and total injected bytes.
- Label every source path.
- Treat repository instructions as untrusted project content below user/system authority.
- Coalesce repeated reads in the same step.
### Tool-output pruning hook
Adopt OpenCode's conservative shape:
```text
protect latest 40,000 estimated tool-output tokens
never prune current/previous user turn
never prune skill loads or durable state snapshots
mark old result as cleared, do not delete audit history
commit only when estimated saving >20,000 tokens
```
Improve it for Boring:
- Preserve errors and verification summaries longer than ordinary successful listings.
- Preserve hashes/paths/counts as a deterministic stub.
- Keep full raw result in durable storage/UI.
- Make model-visible clearing explicit.
### Stable prompt manifest
Build and log:
```json
{
  "promptVersion": "boring-coding-v1",
  "behaviorHash": "...",
  "projectInstructionHashes": ["..."],
  "skillCatalogHash": "...",
  "toolCatalogHash": "...",
  "environmentHash": "..."
}
```
This makes cache misses diagnosable without logging sensitive prompt bodies.
## Risks and trade-offs
| Risk | Trigger | Mitigation |
|---|---|---|
| Lost PI operational guidance | Replacing default prompt too aggressively | Snapshot essential guidelines; run tool-use evals before rollout |
| Local-rule prompt injection | Loading nested repository files | Preserve authority labels; workspace bounds; source paths; user/system precedence |
| Cache fragmentation | Dynamic tenant/user instructions in prefix | Stable base + late scoped message; hash/telemetry |
| Summary hallucination | More aggressive compaction | Deterministic file/tool state; exact stubs; retain raw transcript |
| Evidence loss | Tool-output pruning | Protect errors/recent turns; high saving threshold; reversible model projection |
| Schema breakage | Trimming native JSON Schema | Trim prose only first; never remove validation-critical structure without tests |
| Model-family divergence | Separate prompts | Shared invariant core plus small family overlays and eval matrix |
| Child overspend | Fresh delegated sessions | Parent quota allocation and child usage chargeback, following Eve |
| Stale project context | Startup-only resource loading | Nested resolver and content-hash invalidation |
| Prompt size hiding | Text-only test | Measure whole provider request |
## Recommended implementation sequence
### Phase 0: measurement
1. Capture representative complete provider requests without secrets.
2. Attribute tokens to system sections, tool descriptions, schemas, and messages.
3. Record cache-read/cache-write usage per turn.
4. Add prompt-version and section-hash telemetry.
5. Establish task-success evals for editing, diagnosis, research, and delegation.
### Phase 1: cheap prompt reduction
1. Supply a Boring `customPrompt`.
2. Delete PI self-documentation from the active prompt.
3. Require concise `promptSnippet` values.
4. Sort all catalogs deterministically.
5. Keep volatile values at the tail or in synthetic messages.
6. Add explicit instruction precedence.
### Phase 2: context quality
1. Implement nested file-local instructions.
2. Expose compaction reserve/recent settings.
3. Preserve/reinject Boring tool state around compaction.
4. Add old tool-result pruning behind a flag.
5. Compare structured checkpoint formats in evals.
### Phase 3: scale controls
1. Add provider-token session budgets.
2. Allocate delegate quotas from the parent's remaining budget.
3. Add bounded tool discovery only for catalogs that exceed a measured threshold.
4. Consider OpenCode Code Mode only if connector scale justifies its interpreter/security cost.
## Evaluation plan
### Quality metrics
- Task success without user correction.
- Correct adherence to nearest nested instruction.
- Tool-selection accuracy.
- Rate of invented/unavailable capability claims.
- Post-compaction continuation success.
- Exact-path/symbol/error preservation after compaction.
- Delegate brief sufficiency and child completion rate.
### Cost metrics
- Fixed request tokens before user message.
- Native tool-schema tokens.
- Cache write tokens on first turn.
- Cache read tokens on subsequent turns.
- Uncached input tokens caused by prompt mutation.
- Tokens per successful task.
- Summary-call tokens and frequency.
- Delegate-tree total tokens.
### Experiment cells
| Cell | Prompt | Tool prose | Nested instructions | Compaction |
|---|---|---|---|---|
| Control | PI default | duplicated | startup only | 16,384 / 20,000 |
| A | Boring custom | concise | startup only | same |
| B | Boring custom | concise | file-local | same |
| C | Boring custom | concise | file-local | 16,384 / 12,000 |
| D | Boring custom | concise | file-local | + old-result pruning |
Do not bundle all changes into one comparison; otherwise quality gains cannot be attributed.
## Bottom line by framework
### Flue
Best ideas to harvest:
- Stable prompt prefix and explicit rebaseline semantics.
- Small direct-child orientation listing if measured useful.
- Model-aware reserve that degrades sensibly on small windows.
- Compact structured summaries with only 8,000 recent tokens.
- Fresh, isolated child context and explicit delegation-depth cap.
Weaknesses:
- Only cwd instruction files.
- Frozen directory snapshot.
- No pre-pruning of tool results.
- No prompt-section byte budgets.
### Eve
Best ideas to harvest:
- “Whatever you write is the prompt”: clear ownership.
- Deterministic build-time instruction compilation.
- Conditional tool exposure.
- Checkpoint envelope included in trigger math.
- Framework state restoration/reset around compaction.
- Parent quota allocation to child sessions.
- Clear distinction between copied-root and declared subagents.
Weaknesses:
- No automatic arbitrary-repository `AGENTS.md` handling.
- No documented tool-schema budget.
- Dynamic step-scoped capabilities can destroy cache reuse.
- Compaction public docs expose fewer exact tail/accounting details than PI/Flue source.
### OpenCode
Best ideas to harvest:
- Model-family prompts.
- Nested, path-relevant instruction discovery.
- Deterministic tool sorting.
- Old tool-result pruning before full summary.
- Summary tail bounded to recent turns and 2,000–8,000 tokens.
- Complete-request estimation in v2 core.
- Bounded 2,000-token Code Mode catalog for huge tool sets.
Weaknesses:
- Volatile environment appears before stable instructions/skills.
- Daily date harms cross-day cache reuse.
- No general prompt size limit.
- Two compaction implementations during transition complicate operational understanding.
- Code Mode is substantial security-sensitive machinery.
### PI / Boring UI
Strengths:
- Mature provider normalization and caching adapters.
- Good ancestor instruction discovery.
- Progressive skill loading.
- Structured, persistent compaction with hooks.
- One-retry overflow recovery.
- Application-owned delegation already gives Boring control.
Weaknesses:
- Oversized generic default prompt.
- PI self-documentation is irrelevant in embedded use.
- Tool description duplication.
- Text-only prompt-size regression misses schemas.
- No nested instruction discovery.
- No pre-pruning of old tool results.
- Compaction settings are not surfaced by Boring's harness.
- Dynamic prompt rewrites can invalidate caches.
## Evidence ledger
### Flue 2.0.3 local exact sources
- `@flue/runtime/dist/conversation-stream-store-CXwRWonS.mjs`: `readAgentsMd`, `composeSystemPrompt`, environment assembly.
- `@flue/runtime/dist/dispatch-nU3cIlT-.mjs`: token estimation, reserve derivation, compaction trigger, summary generation, overflow retry.
- `@flue/runtime/dist/result-DfjetCf9.mjs`: detached task tool description and schema.
- Offline docs: `reference/agent-behavior`, `guide/models`, `reference/agent-hooks-api`, `guide/skills`, `guide/subagents`.
- Official repository: [Flue runtime source](https://github.com/withastro/flue/tree/main/packages/runtime/src).
### Eve 0.31.3 official sources
- [Instructions at tag 0.31.3](https://github.com/vercel/eve/blob/eve%400.31.3/docs/instructions.mdx).
- [Agent config at tag 0.31.3](https://github.com/vercel/eve/blob/eve%400.31.3/docs/agent-config.md).
- [Default harness at tag 0.31.3](https://github.com/vercel/eve/blob/eve%400.31.3/docs/concepts/default-harness.md).
- [Subagents](https://github.com/vercel/eve/blob/eve%400.31.3/docs/subagents.mdx).
- [Project layout](https://github.com/vercel/eve/blob/eve%400.31.3/docs/reference/project-layout.md).
- [Eve changelog](https://github.com/vercel/eve/blob/main/packages/eve/CHANGELOG.md), especially 0.24.2 checkpoint behavior.
### OpenCode official sources
- [System prompt selector/environment/skills](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/system.ts).
- [Session assembly](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/prompt.ts).
- [Request prompt concatenation](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/llm/request.ts).
- [Instruction discovery](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/instruction.ts).
- [Established compaction](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/compaction.ts).
- [Overflow accounting](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/overflow.ts).
- [Provider transforms and cache points](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/provider/transform.ts).
- [V2 core compaction](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/compaction.ts).
- [Task/subagent tool](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/task.ts).
### PI 0.80.7 local exact sources
- `node_modules/@mariozechner/pi-coding-agent/dist/core/system-prompt.js`.
- `node_modules/@mariozechner/pi-coding-agent/dist/core/resource-loader.js`.
- `node_modules/@mariozechner/pi-coding-agent/dist/core/skills.js`.
- `node_modules/@mariozechner/pi-coding-agent/dist/core/compaction/compaction.js`.
- `node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.js`.
- `node_modules/@earendil-works/pi-agent-core/dist/harness/*` for the non-active newer harness comparison.
- Installed `@earendil-works/pi-ai` provider adapters for Anthropic/OpenAI/Bedrock cache behavior.
### Boring UI local exact sources
- `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`.
- `packages/agent/src/server/harness/pi-coding-agent/tool-adapter.ts`.
- System-prompt regression test adjacent to the PI harness.
- `packages/agent/src/server/mcp/managedAgentDelegate.ts`.
- `packages/agent/src/server/mcp/managedAgentMcpServer.ts`.
## Final recommendation
Take ownership of the **behavioral prompt text and its ordering**, while continuing to delegate the loop, providers, transcript, tools, and compaction machinery to PI.
Do not fork PI merely to shorten the prompt.
Use `customPrompt` now.
Use concise `promptSnippet` values now.
Instrument the complete request now.
Add nested instruction retrieval in the Boring host next.
Expose PI compaction settings next.
Only take ownership of deeper context mechanics where PI has no seam: stable-prefix/rebaseline policy, per-file instruction injection, old-tool-result pruning, and session/delegate token budgets.
