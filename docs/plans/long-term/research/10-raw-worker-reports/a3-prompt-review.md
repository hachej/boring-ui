# Part 1 — Attack

## Verdict table

| Recommendation | Verdict | Evidence | What to do instead |
|---|---|---|---|
| 1. Replace Pi's default prompt with a Boring `customPrompt` | WEAK | The removable default is only 2,767 characters in a clean Boring session, approximately 692 tokens by Pi's own `chars / 4` estimator. The installed SDK has no `customPrompt` option on `createAgentSession`; the seam is `DefaultResourceLoader.systemPromptOverride`. | Replace only after an A/B quality gate. Use a versioned Boring base prompt, preserve Pi's appended project context, skills, cwd, and Boring path/security rules, and measure complete provider requests rather than prompt text alone. |
| 2. Require a no-duplication, at-most-80-character `promptSnippet` | WEAK | `promptSnippet` is a real Pi catalog field but not a provider concept. Pi documents it as an optional short one-line entry; neither Pi nor the providers impose 80 characters. The provider still receives the full tool `description` and schema. | Keep `description` provider-facing. Make `promptSnippet` optional, human-written, single-line, and linted for semantic coverage; omit the entire prose catalog under a custom prompt unless routing A/B tests show it helps. |
| 3. Measure full request tokens, including tool schemas | SOUND | The current 36,000-character regression test sees only system text. Anthropic and Gemini receive native tool declarations separately, so it cannot detect schema inflation or report billable/cached token behavior. | Capture the final adapter request plus provider usage, split by system text, tools, messages, cache reads, cache writes, and uncached input. Establish per-model baselines. |
| 4. Resolve nested instructions by target file; closest wins | SOUND | Pi loads ancestor instruction files at startup but does not discover descendant rules for a later target. OpenCode resolves instructions for target paths. “Closest wins” is incomplete for multi-file operations and cannot override system/user authority. | Resolve per canonical target, merge root-to-leaf within repository authority, and inject before mutation. Cache by path and instruction digest; test conflicts, two-package edits, new files, and symlinks. |
| 5. Expose Pi compaction settings in Boring config | SOUND | Pi already exposes reserve/recent settings, while workload needs differ. The proposed 16,384/12,000 and 20,000/8,000 profiles are unvalidated guesses, not evidence. | Expose knobs without changing defaults first. Replay coding and research sessions, then choose profiles from success-versus-token curves. |
| 6. Move volatile dynamic material out of the fixed prefix | SOUND | Anthropic cache entries require exact prefix matches across tools, system, and messages. Pi marks the system block, last tool, and last user content. Gemini 2.5+ has implicit prefix caching, but Pi does not create explicit Gemini caches. | Keep tools and system byte-stable; emit volatile facts as late typed messages. Verify with provider `cacheRead`/`cacheWrite`, not a nominal “hit-rate” claim. |
| 7. Add explicit instruction precedence text | SOUND | A stable precedence rule makes conflicts testable, but text alone cannot enforce security boundaries or solve per-target repository scope. | State the authority order once and enforce it in the resolver/tool layer. Add conflict fixtures that require observable different outputs. |
| 8. Add OpenCode-style pruning of old tool output | WEAK | OpenCode's 20,000-token minimum saving and 40,000-token protected tail are heuristics. It replaces model-visible evidence with `[Old tool result content cleared]` before summary creation. No source evidence establishes answer preservation. | Use a reversible projection: typed evidence stubs plus durable full output and rehydration. Protect errors, verification, approvals, state, and pinned evidence. Trigger from measured context pressure. |
| 9. Use model-family prompt variants | WEAK | The harvest gives no demonstrated model-specific failure, expected delta, or retirement rule. Variants multiply prompt/cache keys and test cells. | Start with one provider-neutral prompt. Add a small versioned delta only after a reproducible family-specific failure and remove it when the eval no longer needs it. |
| 10. Trim skill-catalog locations | WEAK | Pi's catalog tells the model where to read each skill; deleting locations can break loading. Absolute-path “noise” was not measured separately. | Replace paths only together with a stable skill-load handle/tool. Compare routing and load-success rates, not catalog length alone. |
| 11. Add a small environment tail | WRONG | Boring already appends workspace/path rules and Pi appends cwd. Adding cwd/workspace again duplicates data; git status and platform are volatile and damage a stable system cache block. | Keep stable path semantics in system text. Return live git/platform facts through tools or a late environment message only when relevant. |
| 12. Remove the date from the stable prompt | WRONG | The installed Pi prompt contains no date. Boring's composed append contains no date. The measured active prompt therefore saves exactly 0 characters and 0 tokens by “removing” it. | Add a clock tool or a late, request-scoped time fact only for time-sensitive tasks. Guard the fixed prompt with a no-volatile-date snapshot test. |

The source document currently contains 15 ranked rows, despite calling this a 12-item set. This review evaluates the requested ranks 1 through 12. Rows 13 through 15 are not silently treated as members of the stated set.
## 1. What Pi's default prompt actually contains

Installed package resolution:

- Requested package name: `@mariozechner/pi-coding-agent`.
- Resolved implementation: `@earendil-works/pi-coding-agent` version 0.80.7.
- Prompt source: `node_modules/@mariozechner/pi-coding-agent/dist/core/system-prompt.js`.
- Session SDK type: `dist/core/sdk.d.ts`.
- Resource-loader type: `dist/core/resource-loader.d.ts`.

The default branch has six ordered regions.

1. Persona and capability sentence.
   It calls the model an expert coding assistant operating inside Pi. It names reading, command execution, editing, and writing. It does not specify read-before-edit discipline. It does not specify approval, sandbox, or refusal behavior.

2. `Available tools` prose catalog.
   It includes only selected tools with a nonempty `toolSnippet`. Each line is `- name: snippet`. This is separate from provider-native tool declarations. Boring currently gives Pi a snippet for every adapted tool.

3. Custom-tool bridge sentence.
   It says other project-dependent custom tools may be available. It adds no selection criteria or safety rule.

4. Guidelines.
   Pi adds a bash exploration rule only when bash exists without grep/find/ls. It then adds caller-provided `promptGuidelines`. It always says to be concise. It always says to show file paths clearly.

5. Pi documentation block.
   It contains absolute paths to README, docs, and examples. It maps Pi subjects to specific documentation files. It tells the model to resolve Pi docs against those absolute roots. It tells the model to read Pi Markdown completely and follow links. This block is useful only for questions about Pi itself.

6. Always-retained suffix assembled after either branch.
   Boring's `appendSystemPrompt` is appended first. Project context files follow inside `<project_context>`. Skills follow when `read` is selected. The current working directory is the final line.

The `customPrompt` branch replaces regions 1 through 5 only. It does not remove project context. It does not remove skills. It does not remove cwd. It does not remove Boring's appended path/security guidance.
### Load-bearing classification

Provider tool-call syntax is not carried by this prose. The provider receives native tool names, full descriptions, and JSON schemas. Replacing Pi prose does not remove those declarations.

Tool selection can still depend on the prose catalog. That is a behavioral hint, not protocol correctness. Removing it can lower or improve routing depending on redundancy and model. The direction is empirical.

The only active edit-specific snippet says: “Make precise file edits with exact text replacement, including multiple disjoint edits in one call.” That is useful selection/usage guidance. It is not a general preservation rule. It does not require inspecting a file before editing. It does not prohibit overwriting unrelated changes.

Pi's always-on guidelines are mildly load-bearing for answer style. Dropping them can produce longer answers and less legible file reporting. They are easy to preserve in approximately 15 words.

The Pi documentation block is load-bearing only for Pi-development questions. Boring is itself integrating Pi, so those questions are not impossible. A replacement should route such requests to a docs lookup, not pretend the paths never mattered.

No refusal behavior exists in the default prompt. No safety policy exists in the default prompt. No permission-boundary rule exists in the default prompt. No destructive-command discipline exists in the default prompt. Therefore replacement cannot “preserve” refusal text that is not there. Any refusal regression would come from other Boring instructions or provider behavior.
### Measured size, not adjectives

Measurement used the installed `buildSystemPrompt` through Boring's actual loader and adapted tools. Workspace was `/home/ubuntu/projects/boring-ui-v2`. Ambient global context and skills were isolated to measure the fixed clean case.

- Active full system prompt: 3,774 JavaScript characters.
- Active full system prompt: 3,780 UTF-8 bytes.
- Active full system prompt: 41 lines.
- Pi `chars / 4` estimate: 944 tokens.
- Replaceable default regions 1–5: 2,767 characters.
- Replaceable estimate: 692 tokens.
- Retained Boring append plus cwd: 1,007 characters.
- Retained estimate: 252 tokens.
- Tool prose catalog region: approximately 832 characters.
- Tool prose catalog estimate: approximately 208 tokens.
- Pi documentation region: 1,567 characters.
- Pi documentation estimate: approximately 392 tokens.

The 2,767-character number is a gross ceiling, not a saving. A 700-character replacement costs about 175 estimated tokens. Its clean-session net saving would be 2,067 characters, about 517 estimated tokens. That is 13.7% of the measured 3,774-character system prompt. It is not a “VERY HIGH” complete-request reduction.

Native tool declarations are additional input. Conversation history is additional input. Project instructions and skills are additional input. The current test's historical “~34k” comment therefore cannot be attributed to Pi's base prompt. Pi's replaceable base measured 2,767 characters, only 8.1% of 34,000.
### The exact Boring seam

The harvest says to pass `customPrompt` to `createAgentSession`. That is false for the installed SDK. `CreateAgentSessionOptions` has no `customPrompt` property.

The correct seam is `DefaultResourceLoader` construction in: `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`.

The loader already sets `appendSystemPromptOverride` near the session construction. Add `systemPromptOverride: () => BORING_BASE_PROMPT_V1` beside it. Then pass that loader to `createAgentSession`, as the code already does.

Pi later maps the loader's system prompt into `buildSystemPrompt({ customPrompt: ... })`. That internal mapping is visible in `dist/core/agent-session.js`. It is not a public `createAgentSession` option.
### Naive-replacement regressions

- The model may stop using `plugin_diagnostics` because its routing hint disappears.
- The model may choose `write` where `edit` is more precise.
- It may emit longer final prose after losing Pi's concise rule.
- It may omit paths from its final result.
- It may claim Pi documentation is unavailable during Pi integration work.
- It may use a tool before checking that the tool is offered.
- It may edit without reading if the replacement omits that new safeguard.
- It may overwrite unrelated changes if the replacement omits preservation language.
- It may misunderstand repository/user precedence if the replacement invents an incorrect order.
- It may treat nested repository text as equal to system authority.
- It may receive project context and skills twice if the host copies Pi's retained suffix.
- It may lose cache reuse if the replacement embeds volatile environment state.
### What the existing eval suite covers

`packages/agent/src/eval/live-canary.test.ts` covers a README read, `ls`, and `2 + 2`. It does not cover edit discipline. It does not cover refusal or permission behavior. It does not cover nested instructions. It does not cover post-compaction evidence. It does not compare old and new prompts.

The canary is gated by `ANTHROPIC_API_KEY`. The surrounding eval defaults now point at an OpenRouter Qwen model. That gating/model mismatch weakens its value as a default CI signal.

`packages/agent/eval/standard-tools.yaml` covers tool-name and parameter selection. It tests read, find, write, bash, and edit. It prepends a fake `[SYSTEM]` block inside a user message. It therefore does not exercise Pi's actual system-prompt replacement seam. It asserts calls, not successful execution or preservation of unrelated text.

Skill-routing tests cover creating a deck and avoiding tools. They do not protect Pi base behavior.

`packages/agent/src/server/__tests__/system-prompt-size.regression.test.ts` has a 36,000-character ceiling. Its comment says the baseline is approximately 34,000 characters. The test measures only the assembled system string. It omits native tool schemas. It omits provider tokenizer differences. It omits cache writes and reads. It requires a live key, so ordinary CI may skip it.

The suite does not currently make recommendation 1 safe.
## 2. `promptSnippet`: real Pi field, invented cap

`promptSnippet` is declared by Pi's `ToolDefinition`. Pi's extension documentation calls it an optional short one-line entry. If omitted, the custom tool is absent from Pi's prose `Available tools` list.

It is not an Anthropic request field. It is not a Gemini request field. It is not a general provider API feature. It does not replace the full tool description.

Boring's adapter is: `packages/agent/src/server/harness/pi-coding-agent/tool-adapter.ts`. It currently maps `description: tool.description` for the provider. It maps `promptSnippet: tool.promptSnippet ?? tool.description` for Pi prose.

That fallback creates duplication when a tool omits an explicit snippet. The duplication is Boring policy, not Pi necessity.

The 80-character cap appears nowhere in Pi's API or docs. It appears nowhere in Anthropic tool-use requirements. It appears nowhere in Gemini function-calling requirements. It is an invention in the harvest.

Literal truncation is especially unsafe. It can remove “when to use” conditions. It can remove side-effect warnings. It can remove the distinction between similarly named tools. It can turn a grammatical instruction into misleading fragments.

In the measured Boring catalog, the major long line was `plugin_diagnostics`. Blindly clipping current snippets to 80 characters would save roughly 350 characters. That is roughly 88 tokens by Pi's estimator. The saving is small enough that one wrong diagnostic-tool choice can erase it.

Omitting the whole prose catalog under a custom prompt saves approximately 832 characters. That is approximately 208 estimated tokens in the measured clean session. It is a cleaner experiment than arbitrary per-line clipping.

A sound snippet policy is semantic rather than numeric:

- one physical line;
- unique selection cue;
- action and principal object;
- side-effect cue when mutating;
- no schema restatement;
- no examples unless ambiguity is demonstrated;
- lint warning above a measured soft budget, not destructive truncation.
## 4. “Closest wins” needs an authority and timing model

Pi startup discovery walks ancestors and loads the first recognized instruction file per directory. It orders ancestor context root-to-cwd. It does not discover an `AGENTS.md` below cwd merely because a later tool targets that subtree.

The target-file resolver closes that gap. However, “closest wins” applies only among repository instruction files. System policy still outranks repository files. User instructions still outrank repository files unless system policy says otherwise. Tool safety and approval enforcement cannot be downgraded by an `AGENTS.md`.

A single turn can touch two packages with conflicting local rules. There is no single closest file for that turn. Resolution must be per target.

Injection must happen before mutation. Appending rules to a successful `edit` result is too late. Appending them to a `read` result works only if mutation requires a prior read.

Pi exposes two useful extension seams:

- `tool_result` may replace content, details, and error status.
- `context` may replace the model-visible message array before provider calls.

The simplest safe first version is:

1. Append newly discovered target rules to `read` results.
2. Require a successful current-content read before edit/overwrite.
3. On unseen new-file rules, block the first write preflight without mutation.
4. Return the applicable rules in that blocked result.
5. Permit retry only after the rules have entered context.

This costs a turn for direct new-file writes. A deeper host integration could inject preflight context without the retry. The retry design is easier to prove safe with Pi's current public events.
## 6 and 12. Actual cache behavior

### Anthropic through installed Pi

Pi's Anthropic adapter applies cache control to three boundaries:

- the system-prompt block;
- the last eligible tool declaration;
- the last user content boundary.

Default cache retention is short. Anthropic's short cache TTL is 5 minutes and refreshes on a hit. Pi can request a 1-hour cache with `PI_CACHE_RETENTION=long` when supported. Pi can disable it with `PI_CACHE_RETENTION=none`.

Anthropic requires a 100% exact prefix match through a cache breakpoint. The prefix order is tools, then system, then messages. Changing a tool declaration invalidates the whole following prefix. Changing system text preserves a tool-level prefix but invalidates system and messages. Changing an early message invalidates that message and everything after it.

Anthropic's documented multipliers are concrete:

- 5-minute cache write: 1.25 times base input price;
- 1-hour cache write: 2 times base input price;
- cache hit: 0.1 times base input price.

Moving volatility from system into a late message can preserve tool and system cache hits. Moving volatility to the end of the same system string does not help. Pi submits that string as one cache-controlled system block.

Source: [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching). Source: [Anthropic tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching).
### Gemini through installed Pi

Pi's Google adapter sends `systemInstruction`, `tools`, and `contents` normally. It does not create a cache resource. It does not send an explicit `cachedContent` handle. It records `usageMetadata.cachedContentTokenCount` as cache-read tokens. It records cache-write tokens as zero.

Therefore Boring gets only Gemini implicit caching through this adapter. Gemini 2.5 and later support implicit caching automatically. Google explicitly says implicit cache hits are not guaranteed. A common large prefix at the beginning and requests close in time improve the chance.

The documented Gemini 2.5 Flash and Pro implicit-caching minimum is 2,048 input tokens. The measured clean Boring system prompt is approximately 944 tokens by Pi's estimator. That system text alone is below the minimum. Tools and conversation can bring the total common prefix above it.

Explicit Gemini caching defaults to a 1-hour TTL. That fact is irrelevant until Pi or Boring actually creates and references explicit cache objects.

Source: [Gemini context caching](https://ai.google.dev/gemini-api/docs/caching).
### Model-support conclusion

Anthropic caching is active in Pi unless disabled and the selected model is incompatible. Gemini 2.5 implicit caching is available, but nondeterministic. The repository also contains Anthropic and Gemini 2.5 Flash eval cells. Boring has no repository-wide hard-coded default whose cache support can be answered once: `packages/agent/src/server/models/modelConfig.ts::readConfiguredDefaultModel` reads `BORING_AGENT_DEFAULT_MODEL`, provider/id variables, Pi settings, and configured provider fallbacks. The harness then lets Pi choose its own fallback when all are absent. Without the deployed environment/settings, “our default does not cache” is not a factual premise. For the two requested families, current Anthropic and Gemini 2.5 models do support the caching modes described above.

Recommendation 6 is not worth zero for these model families. Its benefit is deterministic and measurable on Anthropic. Its benefit is probabilistic and only usage-observable on Gemini through current Pi.

Recommendation 12 is worth exactly zero today. There is no date to remove.
## 8. Cases where pruning changes the answer

OpenCode's implementation is in [session/compaction.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/compaction.ts). It starts considering old tool output only after the newest two user turns. It protects a fixed 40,000 estimated-token tail. It prunes only when candidates exceed 20,000 estimated tokens. It exempts only the `skill` tool by name. It marks results compacted and serializes a cleared placeholder to the model.

Those constants do not scale with a model's context window. They do not encode evidence value. They do not encode side-effect repeatability. They do not prove safety.

Pruned evidence can change the answer in all of these cases:

- An old compiler error contains the only exact diagnostic and line number.
- A later edit changes the file, so rereading cannot reconstruct pre-edit content.
- A deleted file's prior read was the only surviving content.
- A mutable web/API/database result has changed since the original call.
- A command produced a one-time migration identifier.
- An approval result proves that a side effect was authorized.
- A test result proves which checks actually ran.
- A negative grep result supports elimination of a hypothesis.
- A stack trace distinguishes two failures with the same top-level message.
- A hash or checksum is needed for provenance.
- A subagent result contains analysis not stored elsewhere.
- An OCR or image result cannot be recreated from text alone.
- A user later asks for “the third result from earlier.”
- An old `git diff` is the only record of a pre-change state.
- A deployment result contains the released version or URL.
- Retrying a pruned mutating tool would duplicate a side effect.

Pruning before summarization can make the summary worse. The summarizer sees the cleared marker rather than the evidence. The durable transcript may retain output, but the model cannot cite or reason from it.

The safe claim is narrower: some old, reproducible, low-value output can be projected more compactly. That claim is falsifiable. The harvest's blanket “major savings” is not a safety argument.
## Unfalsifiable wording in the harvest

“Very high cost reduction” has no denominator, provider, workload, or threshold. “Higher behavioral precision” names no behavior or score. “High recurring token saving” names no session distribution. “No capability loss” has no routing or execution criterion. “High quality gain in monorepos” has no conflict fixture or adherence metric. “Medium/high quality gain” for compaction settings has no task set.
“Higher cache hit rate” lacks provider, TTL, inter-request timing, and prefix size. “Reduces conflict ambiguity” lacks a conflict corpus. “Major savings” for pruning lacks context-pressure and answer-accuracy constraints. “Quality gain” for model variants lacks a demonstrated family-specific failure. “Small/medium savings” for skill paths lacks a catalog baseline. “Faster initial orientation” lacks latency and first-tool metrics. “Small but real cross-day cache win” is false for the prompt actually shipped.

Every one of those claims should be rewritten as an experiment with a numeric pass condition.
# Part 2 — Hardened surviving set

## S1. Versioned Boring base prompt, guarded by complete-request A/B

Original ranks: 1, 2, and 7.
### Exact seam

Add a constant near the Pi harness, for example: `packages/agent/src/server/harness/pi-coding-agent/systemPrompt.ts`.

Export `BORING_BASE_PROMPT_V1`. Keep it stable and versioned.

In `createHarness.ts`, add this to `new DefaultResourceLoader({...})`: `systemPromptOverride: () => BORING_BASE_PROMPT_V1`.

Do not pass `customPrompt` to `createAgentSession`. That option does not exist in installed 0.80.7.

Do not copy project context, skills, or cwd into the constant. Pi appends those after the custom base.

Keep `appendSystemPromptOverride` exactly once. It carries Boring's workspace-relative path and host guidance.

Change `adaptToolForPi` so `promptSnippet` does not fall back silently:

```ts
promptSnippet: tool.promptSnippet
```

Under the custom base, omit a prose tool catalog initially. Provider-native declarations remain present. If A/B shows routing loss, add only empirically useful snippets.
### Minimum base behavior

The base must include:

- follow system, user, and applicable repository instructions;
- inspect current content before mutation;
- preserve unrelated changes;
- respect tool/permission boundaries;
- never claim a tool result that was not observed;
- verify proportionately;
- keep final answers concise with paths and checks;
- repository rules resolve per target, root-to-leaf within repository authority.

Do not encode current date, git status, plugin roster, or selected model. Do not list provider-native schemas in prose. Do not claim safety guarantees the tool layer does not enforce.
### Baseline

Store these measured starting values for the clean fixture:

- system characters: 3,774;
- system bytes: 3,780;
- Pi estimated tokens: 944;
- replaceable characters: 2,767;
- tool-catalog characters: approximately 832.

Also record actual tokenizer counts for each selected model. The chars/4 estimator is only a continuity metric.
### Proof measurement

For at least 100 deterministic/replayable tasks per model family, compare:

- provider input tokens per successful task;
- uncached input tokens per successful task;
- cache-write and cache-read tokens;
- correct first tool selection;
- successful tool execution;
- task completion without human correction;
- unrelated-diff preservation;
- final-answer path/check accuracy;
- total turns and latency.

Ship only if the 95% confidence interval excludes more than a 2 percentage-point success loss. Require at least a 10% median uncached-input reduction on sessions under 10 turns. Require no increase in destructive or out-of-scope mutations.
### Regression evals

Add a structural prompt test with a fake resource loader and no network. Assert exactly one Boring base block. Assert retained project context, skills, append block, and cwd. Assert Pi docs paths are absent. Assert no ISO date or locale date appears.

Add tool-routing pairs with confusable tools:

- read versus grep;
- edit versus write;
- bash versus find;
- plugin diagnostics versus generic bash inspection.

Add an edit fixture with unrelated dirty hunks. The agent must read, change one target span, and preserve the other hunk byte-for-byte.

Add a Pi-documentation fixture. The agent must discover/read installed docs through an offered search/read mechanism. It need not carry absolute Pi docs paths in every prompt.

Add a refusal/permission fixture. The prompt is not the enforcement oracle. The tool layer must deny an out-of-workspace write even if repository text asks for it.
## S2. Complete provider-request accounting

Original rank: 3.
### Exact seam

Use Pi's `before_provider_request` and `after_provider_response` events where available. If serialized request detail is insufficient, instrument the installed provider adapter boundary.

Add a Boring extension factory in: `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`.

Record a redacted manifest, never secrets or raw private content. Include stable digests and sizes for:

- tool declarations;
- system blocks;
- each message role/content part;
- images/files;
- provider options that affect cache identity.

Record provider usage fields after the response:

- input tokens;
- output tokens;
- cache-read tokens;
- cache-write tokens;
- reasoning tokens if reported;
- provider/model identifier;
- finish reason.
### Baseline

The existing baseline is only a 36,000-character system ceiling. Retain it as a coarse tripwire, but do not call it cost accounting.

Establish four fixtures:

1. Clean session, no context files or skills.
2. Real Boring repository instructions and default skills.
3. Ten custom tools with representative schemas.
4. Large MCP-like catalog with 100 tools.

Run each on Anthropic and Gemini 2.5 Flash. Persist median and p95 request components.
### Proof measurement

The accounting is successful when component totals reconcile with provider usage within tokenizer tolerance. Set tolerance to 3% for locally tokenized text. Treat provider-reported tokens as billing truth.

Fail CI on an unexplained 5% increase in fixed request tokens. Require a named snapshot section to change when schemas grow. Do not fail merely because cached tokens replace uncached tokens; report both.
### Regression eval

Add one schema-description bloat mutation of 5,000 characters. The new test must fail and name `tools`, not `system`.

Add one dynamic-message mutation. The manifest must show the fixed prefix digest unchanged.
## S3. Target-scoped nested instruction resolver

Original ranks: 4 and 7.
### Exact seam

Create: `packages/agent/src/server/harness/pi-coding-agent/nestedInstructions.ts`.

Expose:

```ts
resolveInstructionsForTarget(workspaceRoot, target): ResolvedInstructionSet
```

Canonicalize the target before walking parents. Reject paths outside the workspace after symlink resolution. For a new file, resolve from its existing parent directory.

Recognize the same filenames Pi recognizes. Document whether one file or multiple aliases per directory are allowed. Match Pi's existing first-match behavior to avoid double semantics.

Return root-to-leaf ordered entries with:

- canonical instruction path;
- content digest;
- directory scope;
- content;
- precedence index.

Integrate at `adaptToolsForPi` or as a dedicated extension factory. On read, append a typed `<system-reminder>` carrying only newly applicable rules. On edit/write, preflight before execution. Block unseen-rule mutation and return those rules without performing the mutation.

Track acknowledged instruction digests per target scope in session state. Invalidate when mtime, size, or content digest changes.

Do not inject all found rules into the fixed system prefix. Do not let repository content impersonate system/user authority. Use escaped structured fields and explicit untrusted-repository provenance.
### Baseline

Current Pi behavior sees ancestor instructions discovered at session start. It misses a descendant package rule until manually read.

Build a 40-case fixture matrix:

- 10 root-only targets;
- 10 nested-conflict targets;
- 10 turns touching two packages;
- 5 new files;
- 5 symlink/boundary cases.
### Proof measurement

Primary metric: applicable-rule adherence rate. Target at least 95% on nested-conflict cases.

Guardrails:

- zero out-of-workspace resolution;
- zero mutations before unseen applicable rules are delivered;
- no duplicate reminder for unchanged scope in one turn;
- p95 resolver latency under 5 ms for a warm cache;
- median added input below 400 tokens per newly entered scope.
### Regression evals

Root says double quotes; nested says single quotes. Editing nested target must use single quotes. Editing root target in the same turn must use double quotes.

Nested rule says do not modify generated file. An edit attempt must be blocked before bytes change.

User explicitly requests an allowed style override. The expected result must exercise the documented authority order.

Repository rule asks to escape workspace or reveal secrets. Tool enforcement must deny it.

Instruction file changes midway through a session. The next target operation must deliver the new digest once.
## S4. Compaction controls before compaction-policy changes

Original rank: 5.
### Exact seam

Locate Pi's `SettingsManager` creation in `createHarness.ts`. Thread optional Boring configuration into Pi's compaction settings.

Expose two explicit values:

- `reserveTokens`;
- `keepRecentTokens`.

Validate both as nonnegative integers. Require `reserveTokens + keepRecentTokens` below the selected model context window. Log effective values with model context size.

Do not ship the harvest's proposed profiles as defaults yet. Expose them only as named experimental presets.
### Baseline

Replay at least 30 real coding sessions and 30 research sessions. Capture current compaction time, summary size, retained evidence, total input, and success.
### Proof measurement

Plot task success against total provider input for each preset. Choose a Pareto improvement, not the smallest transcript.

No preset may reduce exact-answer accuracy by more than 2 percentage points. No preset may increase repeated mutating tool calls. Report the number of sessions that compact at all.
### Regression eval

Use a synthetic long session containing:

- an old acceptance criterion;
- an old compiler error;
- a completed migration ID;
- recent file contents;
- a final request depending on each.

Run each compaction profile and assert all four facts remain recoverable.
## S5. Stable prefix and late dynamic updates

Original rank: 6.
### Exact seam

Keep `BORING_BASE_PROMPT_V1`, tool declarations, and static host append byte-identical.

The existing dynamic seam is `buildDynamicPromptExtension` in the Pi harness. Audit what it emits and when. Use a typed custom/synthetic message for changed dynamic material.

Examples of dynamic material:

- plugin roster changes;
- current git state;
- runtime environment changes;
- current time;
- refreshed remote policy state.

Coalesce updates by semantic key. Do not append the same value twice. Include source, version/digest, effective time, and superseded digest.

For Anthropic, place dynamic content after the stable system cache boundary. For Gemini, keep the earliest request prefix byte-identical and order volatility late.
### Baseline

Anthropic experiment:

1. Send the same tools/system and a first user turn.
2. Send a second turn within 5 minutes.
3. Repeat with one dynamic fact changed in system.
4. Repeat with the fact changed in a late message.

Gemini experiment:

Run 50 paired sessions per condition on Gemini 2.5 Flash. Keep requests close in time and above 2,048 common-prefix tokens.
### Proof measurement

Anthropic success criterion: the late-message condition preserves nonzero system-prefix cache reads when the system-change condition does not.

Report cache economics directly:

```text
effective input units = uncached + 1.25 * short_write + 2.0 * long_write + 0.1 * read
```

Use the actual configured TTL multiplier.

Gemini success criterion: paired median `cachedContentTokenCount` is higher with the stable early prefix. Because implicit hits are not guaranteed, report confidence intervals and miss rate.
### Regression evals

Change plugin roster between turns. The agent must use the new roster and not the superseded one.

Change dynamic policy version. The latest version must govern while fixed-prefix digest remains stable.

Assert no date-like value enters the system prompt.
## S6. Reversible tool-result projection, not blind pruning

Original rank: hardened replacement for 8.
### Exact seam

Use Pi's `context` extension event. It can return a projected `AgentMessage[]` before each provider call.

Register the extension factory in `createHarness.ts`. Do not mutate the durable session transcript.

Persist large full results in a Boring-managed artifact store. Use a session-scoped path or content-addressed object. Do not rely on a transient model-visible `/tmp` path.

Replace eligible old content with a typed stub containing:

- tool call ID;
- tool name;
- normalized target or command class;
- success/error status;
- exit code when applicable;
- byte and line counts;
- SHA-256 digest;
- first and last bounded excerpts;
- artifact handle;
- retention/expiry;
- rehydration instruction.

Add a read-only `tool_result_read` tool keyed by artifact handle. It must never repeat the original side effect.

Never project away:

- errors still relevant to an open task;
- latest verification results;
- approvals and denials;
- migration/deployment identifiers;
- state/todo/checkpoint tools;
- results pinned by the model or host;
- non-reproducible remote evidence without a durable copy;
- outputs referenced by an unresolved user request.

Trigger from actual remaining context, not fixed absolute constants alone. Start when projected next request exceeds 70% of model context. Protect at least the newest two user turns. Require projected savings of at least 5% of context. Treat these as starting hypotheses to validate, not universal truths.

Summarize before replacing evidence needed by the summarizer. Alternatively provide stubs plus artifact access during summarization.
### Baseline

Compare three policies:

1. Pi current compaction only.
2. OpenCode-equivalent 40,000 protect / 20,000 minimum.
3. Reversible pressure-based projection.

Use at least 50 long-horizon transcripts. Half must require an old exact tool fact in the final answer. At least 10 must contain non-idempotent tool calls.
### Proof measurement

- final exact-fact accuracy;
- total input tokens;
- compaction count;
- artifact rehydration rate;
- repeated tool-call rate;
- repeated side-effect count;
- final citation/provenance accuracy;
- tokens per successful task.

Require zero repeated non-idempotent side effects. Require at least 98% exact-fact recovery on protected-evidence tasks. Require at least 20% median input reduction among sessions that cross 70% context.
### Regression evals

Prune an old test log, then ask which test failed and at what line. The agent must rehydrate rather than rerun.

Prune a deployment result, then ask for the deployment ID. The exact ID must be returned from durable evidence.

Prune a destructive command result. The original command must never be executed a second time.

Expire an artifact deliberately. The model must report unavailable evidence, not fabricate it.
## S7. Evidence-gated model-family deltas

Original rank: narrowed version of 9.
### Exact seam

Select a small delta beside `BORING_BASE_PROMPT_V1` using Pi model provider/family metadata. Compose `base + familyDeltaVersion` before assigning `systemPromptOverride`.

Keep each delta under 200 estimated tokens. Give every rule an owning eval ID and expiry/review date in code comments.
### Baseline and gate

Demonstrate the same failure at least 20 times on the affected family. Show that the neutral prompt succeeds less than 80%. Show that the delta improves success by at least 10 percentage points. Show no more than 2 percentage points loss on other core evals.

Delete the variant when model/provider upgrades make the failure disappear. This prevents folklore prompts from accumulating permanently.
## S8. Skill handles instead of path trimming

Original rank: hardened replacement for 10.
### Exact seam

Leave Pi's skill formatter unchanged until a replacement loader exists. Then introduce stable opaque handles such as `skill://package/name`.

Expose a read-only loader that maps handles to canonical approved files. Do not make the model reconstruct absolute paths.
### Baseline and gate

Measure current catalog tokens, correct skill selection, and successful skill load. Run at least 50 routing cases, including duplicate names and package skills.

Ship only if catalog input falls at least 15% with no more than 1 percentage point load-success loss. Test missing, stale, and malicious handles.
# Fresh reference-implementation findings

## Flue 2.0.3

Source command: `npx -y @flue/cli@2.0.3 docs read reference/agent-behavior`.
### System-reminder analogue

Flue narrates changing resources, instructions, and environment as durable signals. Signals are append-only conversation events rather than silently rewriting history. Resource signals carry deltas plus the full current roster. Environment signals carry the full snapshot. Instruction-change signals identify that system instructions changed.

This is stronger than an untyped “remember this” message. It gives dynamic state identity and durability. It also creates a testable coalescing boundary.

The cache nuance is important. Narrating the change late preserves earlier message history. But if the actual system instruction string also changes, provider system-cache identity still changes. Signal design does not repeal provider cache rules.
### Tool results

Flue built-in read output is capped at 2,000 lines or 50 KB. Read keeps the head and supports continuation by offset. Bash output is capped at 2,000 lines or 50 KB. Bash keeps the tail, which better preserves recent errors. Grep returns at most 100 matches and caps each line at 500 characters. Glob returns at most 1,000 paths.

Those are tool-specific projections. They are safer than one generic transcript-pruning rule because head/tail semantics differ by tool.

The reference does not promise generic spill-to-file for arbitrary custom-tool output. Custom output is JSON-stringified for the model. Therefore callers still need deliberate result shaping.
### Stop conditions and limits

Normal completion occurs when the model returns no tool calls. A custom tool can return `{ terminate: true }`. For a parallel batch, termination occurs only if every result terminates. `useAgentFinish` can append a signal and continue in the same response. Flue caps those continuation cycles at 32.

Durable execution defaults are a separate layer: maximum 10 attempts and a 3,600,000 ms timeout. They are not a normal model-step ceiling.
### Tool-description style

Flue exposes name, description, and schema natively. Its guidance says description should cover what the tool does, when to use it, and what it returns. That is descriptive with selection cues. It does not prescribe an 80-character catalog duplicate.
## Eve

Sources: [Eve agent configuration](https://vercel.com/docs/eve/instructions/agent-config) and the Eve package documentation/source referenced there.
### System instructions and reminders

Eve uses `instructions.md` as system instructions before model calls. Durable approvals and pauses carry state across execution boundaries. Its compaction/checkpoint design distinguishes completed work from remaining work.

No inspected Eve reference established a generic system-reminder syntax equivalent to OpenCode's tags. That absence matters: do not attribute an OpenCode mechanism to Eve by analogy.
### Tool results

Eve's important mechanism is `toModelOutput`. The tool can retain or deliver full output to the channel while projecting a smaller model-visible result. An official example limits SQL rows visible to the model to 500.

This is a stronger pattern than global age-based pruning. The tool author knows which fields are identifiers, errors, counts, or bulk payload. Projection happens at the semantic boundary.

Failed tools are returned as failed tool results so the model can recover. They should not be collapsed into generic prose.

The inspected material did not establish generic spill-to-file for every result. Claiming that would exceed the evidence.
### Stop conditions and limits

Documented session-wide input defaults are large spend controls rather than turn caps. The referenced configuration documents 40,000,000 input tokens for a root session. It documents 5,000,000 for a delegated subagent. It documents a default maximum subagent depth of 3 in the referenced version.

Approval and question tools can park execution durably. The inspected agent-config reference does not advertise a fixed normal tool-turn ceiling. Do not conflate token budgets, delegation depth, and step limits.
### Tool-description style

Eve tools use provider-native name, description, and input schema. Guidance emphasizes a clear account of what the tool does and when it should be selected. Examples belong in schema/description only when ambiguity warrants their token cost.
## OpenCode

Primary sources: [session/reminders.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/reminders.ts), [session/compaction.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/compaction.ts), and [tool/truncate.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/truncate.ts).
### System-reminder injections

`session/reminders.ts` injects plan/build state into the last user message. The text uses system-reminder-like tags but remains model-visible message content. It is not a provider system role.

This placement is cache-friendly for earlier prefixes. It is weaker than capability enforcement. Historical OpenCode issues show reminders can conflict with configured permissions.

Lesson for Boring: narrate state in late typed messages, but enforce permissions in the tool layer. Never let reminder wording be the only destructive-action barrier.
### Tool-result truncation and spill

Current `tool/truncate.ts` defaults to 2,000 lines and 50 KB. It supports head or tail projection. It writes the full output to a tool-output file. It returns a preview plus instructions for reading the stored output.

Stored output retention is 7 days. Cleanup runs hourly after initial scheduling. The path is therefore recoverable but not permanent provenance.

OpenCode issue reports show agents sometimes rerun a truncated command instead of reading the stored file. That is dangerous for non-idempotent tools. Boring's rehydration path should be a read-only tool, not advice to rerun.
### Old-output pruning

Compaction protects the newest two user turns. It uses a 40,000-token protected tail. It requires more than 20,000 estimated tokens of candidate saving. It exempts only `skill` results.

Those values are not model-relative. An upstream issue explicitly objects to 40,000 as aggressive on 1-million-token contexts.

Durable result metadata can remain while model serialization shows: `[Old tool result content cleared]`. That is lossy from the model's point of view.
### Stop conditions and max steps

OpenCode agents have a `steps` setting whose default is effectively infinity. Normal looping stops when the assistant finish reason is not tool calls and no calls remain pending.

On the last configured step, OpenCode adds a strongly worded assistant-prefill prompt. It tells the model that tools are disabled and demands a textual summary. At the inspected assembly seam, the tool array is still passed onward. That makes the last-step stop primarily prompt-enforced at that point.

Boring should enforce a hard host-side turn/tool-call budget. At the limit, do not merely tell the model tools are unavailable. Actually remove or deny mutating tools, preserve state, and return an explicit limit reason.
### Tool-description style

OpenCode mixes styles by tool. Many native tools are descriptive and detailed. Control tools such as structured-output completion are imperative and exact. Descriptions commonly state selection conditions and response contracts. They are not uniformly short and do not obey an 80-character cap.

The useful distinction is functional:

- descriptive prose for discovery and read-only lookup;
- imperative constraints for protocol/control tools;
- examples only for ambiguous schemas or exact formatting contracts;
- no repeated schema prose that the provider already exposes.
# New recommendations missed by the harvest

## N1. Separate model-visible projection from durable tool truth

Flue truncates by tool semantics. Eve exposes `toModelOutput`. OpenCode spills full output and returns a preview.

Boring should add a first-class result envelope with:

- durable full result;
- bounded model projection;
- UI projection;
- provenance digest;
- read-only rehydration handle.

This should precede transcript-age pruning. It reduces tokens from the first appearance of a huge result. It preserves evidence better than clearing it later.
## N2. Make stop conditions host-enforced and observable

Add explicit limits for:

- model turns;
- tool calls;
- provider input tokens;
- provider output tokens;
- wall time;
- repeated identical calls.

Return a typed stop reason. Persist unfinished work and last verification state. Do not rely on an assistant reminder to disable tools.

Baseline current distributions before setting defaults. Set initial p99-based warnings before hard limits. Eval one infinite-retry loop and one legitimate long task.
## N3. Treat reminders as typed state, not privileged prose

Every dynamic reminder should include:

- kind;
- source;
- scope;
- version/digest;
- effective timestamp outside the stable prefix;
- supersedes relation;
- trust level.

The renderer may use XML-like tags. The host must not treat the text itself as authorization. Test malicious repository content that closes/spoofs reminder tags.
## N4. Protect failed and verification results by default

Errors and verification output are unusually information-dense. Default result projection should keep their tail, exit code, and diagnostic locations. Compaction should pin the most recent verification for each changed target.

Measure whether a final answer's claimed checks match observed tool results exactly. Fabricated “tests passed” should be a zero-tolerance regression.
## N5. Add idempotency metadata to tool calls

Classify tools as:

- read-only/replayable;
- mutating/idempotent;
- mutating/non-idempotent;
- externally irreversible.

Pruning and rehydration policy should consume that classification. A lost non-idempotent result must never trigger an automatic retry.

Test payment/deploy/message-like fake tools with unique side-effect counters. The counter must remain 1 through truncation and compaction.
## N6. Use tool-description conformance tests, not length caps

Lint each provider-facing description for:

- what it does;
- when to choose it over neighbors;
- side effects;
- key result shape;
- absence of unsupported promises.

Maintain confusion-pair evals. Remove examples that do not improve those evals. Add examples only when they improve first-call correctness enough to repay their recurring tokens.
## N7. Cache manifests must include tool schemas

Anthropic places tools before system in cache hierarchy. One volatile tool description can invalidate the entire following prefix.

Hash and report every tool declaration in stable order. Sort only where provider semantics permit it. Keep dynamic availability out of descriptions when a late capability update can represent it safely.

Add a test that changes one tool description. It must predict full Anthropic prefix invalidation.
## N8. Summarization must cite retained evidence handles

Compaction summaries should not merely paraphrase outcomes. They should record artifact handles and digests for decisive tool results.

Required checkpoint fields:

- user objective;
- completed work;
- remaining work;
- changed files;
- applicable instruction digests;
- verification evidence handles;
- unresolved errors;
- approvals/denials;
- non-idempotent side effects already performed.

Test summary restoration in a fresh process with no in-memory state. The restored agent must not repeat completed side effects.
# Implementation order and acceptance gates

1. Add complete-request accounting first.
   Baseline the current system, tools, cache usage, and success.

2. Add structural prompt snapshots and behavior evals.
   This creates a safety net before replacement.

3. Introduce `BORING_BASE_PROMPT_V1` through `systemPromptOverride`.
   A/B it against Pi default on Anthropic and Gemini.

4. Remove snippet fallback only after routing pairs pass.
   Do not ship the 80-character cap.

5. Implement target-scoped instruction preflight.
   Require no mutation before unseen rules are delivered.

6. Stabilize dynamic prefix placement and cache manifests.
   Verify real provider usage within controlled TTL windows.

7. Add semantic tool-result projection and durable handles.
   Do this before age-based pruning.

8. Expose compaction knobs without changing defaults.
   Select profiles only from replay curves.

9. Add hard host-side stop/budget enforcement.
   Persist explicit typed stop reasons and resumable state.

10. Consider family prompt deltas and skill handles last.
    Require demonstrated failures and measurable wins.

Final decision thresholds:

- no more than 2 percentage points aggregate task-success regression;
- zero out-of-workspace mutations;
- zero repeated non-idempotent side effects;
- at least 10% median uncached-input reduction for the base-prompt change;
- at least 95% nested-rule adherence;
- at least 98% exact-evidence recovery after projection;
- provider cache claims backed by nonzero reported cache-read tokens;
- every prompt variant and reminder has a stable version/digest;
- every claimed verification maps to an observed retained tool result.
