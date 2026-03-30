PI Coding Agent + Vercel AI SDK Chat Migration — Architectural Review
=====================================================================

0. TL;DR (actual call-outs)
   • Conceptually the direction is sound.  
   • Effort, risk and hidden feature parity gaps are badly underestimated (approx. 2-3×).  
   • Browser support for `pi-coding-agent` is not a given; major Node APIs leak.  
   • Transport/event mapping glosses over ordering, back-pressure, retries and duplicate suppression.  
   • Session compaction, branching and JSONL persistence create new correctness and perf risks.  
   • No rollback, monitoring, analytics, or staging cut-over plan is described.  
   • Model-selector / file-upload are much harder than “1-2 days”.  
   • Security surface (XSS, arbitrary file blobs, prompt injections) grows and is un-addressed.  

The remainder gives detailed feedback grouped by the requested dimensions.

---------------------------------------------------------------------
1. Architectural soundness
---------------------------------------------------------------------
What is solid
• Replacing a Shadow-DOM component that can’t be composed with React is the right long-term call.  
• Abstracting “browser vs. server” behind a `ChatTransport` boundary keeps options open.  
• Deleting ~1400 LOC of glue code will reduce maintenance once the dust settles.  

What is shaky / missing
a. Browser viability of `pi-coding-agent`  
   – The package currently ships CommonJS, references `fs`, `path`, `child_process` and spawns real processes for `bash`, `git`, `search` tools. Those calls will crash or silently noop in a browser bundle.  
   – Merely “testing in Phase A” is not sufficient. Either:
     1. Confirm a documented browser build exists, OR  
     2. Plan to polyfill / stub each Node dependency, OR  
     3. Decide that **browser mode must fall back to the backend transport**.  
   – This decision changes the whole sizing and security profile.

b. Session persistence via IndexedDB JSONL  
   – Random-access appends are fine; queries, compaction and branch reads become an O(N) walk. Large projects (>2 K messages) will cause noticeable startup stalls.  
   – No quota checks: many Chromium browsers soft-fail at ~50 MB per origin. You need eviction/cleanup strategy.

c. Compaction / summarisation  
   – Summaries change the assistant context. There is no validation that the compacted summary still satisfies downstream tools (e.g. a filename mentioned only in a deleted part).  
   – Surface artifact provenance currently uses message IDs; those are rewritten during compaction. You noted this but did not provide a concrete mapping strategy.

d. Branching  
   – UI/UX for branch selection, merge or diff is not scoped. Storing the tree alone is not useful.

e. Tool execution in browser  
   – Built-in “file”, “bash”, “git” tools expect a project workspace. In browser they silently error. You must either:
     • Gate them behind server transport, OR  
     • Replace them with RPC calls to the backend, OR  
     • Exclude them from the registered tool set.

f. Abort / cancellation  
   – Your `PiCodingAgentTransport` closes the stream on `abortSignal`, but does **not** propagate cancellation to the agent loop. If the agent continues running you leak compute and get out-of-order events.

g. SSR /  server-side rendering  
   – Stage+Wings currently SSRs pages for SEO. Vercel AI SDK uses `window.*` during hook initialisation. Hydration mismatches not considered.

---------------------------------------------------------------------
2. Missing edge-cases
---------------------------------------------------------------------
1. Streaming order guarantees: tool-call events may interleave with text deltas. Your mapper assumes “text then tool call” sequence.  
2. Partial failures: provider rate-limit (429) mid-stream. Need retry/backoff and UI summarisation.  
3. Multi-tab concurrency: two tabs mutate the same IndexedDB session; last-writer-wins corruption possible.  
4. Offline / reconnect: `reconnectToStream()` stub returns null; on real network drops the UI will freeze.  
5. Large file uploads (>4 MB) hit Vercel 5 MB body limit unless chunked.  
6. i18n / RTL: all new components assume LTR English; previous widget handled RTL via host CSS.  
7. Accessibility: No audit for ARIA roles on custom parts, especially provenance badges and tool cards.  
8. Security:
   • Markdown rendering now happens outside sandboxed iframe; raw HTML from the model can XSS.  
   • File-attachment preview may create blob URLs that live forever (memory leak, privacy leak).  
   • Tools returning shell output must be escaped.  
9. Analytics / metrics: removal of pi-web-ui removes automatic telemetry. Nothing new is planned, so prod observability regresses.

---------------------------------------------------------------------
3. Ordering / dependency issues in execution plan
---------------------------------------------------------------------
• Phase A must first decide on “browser viable or not”. If not, Phases B–E in browser mode are irrelevant.  
• Phase C depends on the message part grammar you finalise in Phase B; build mock components **after** the event contract is frozen.  
• Phase D (session manager) actually blocks Phase B because the transport needs an initialised `SessionManager` up front.  
• Phase F (removal) should happen only after a dark-ship or feature flag proves new chat works for at least a subset of users. No rollback path is drafted.  
• Model selector/file upload (Phase G) are not optional for parity; they must land before Phase F or you break existing workflows.

---------------------------------------------------------------------
4. Evaluation fairness & completeness
---------------------------------------------------------------------
• Comparison table ignores the fact that pi-web-ui’s built-in tools sandbox unsafe HTML; Vercel AI SDK does not––the cost to add that is non-trivial.  
• You award “Accessibility” to Vercel by default, but shadcn/ui is un-audited and requires manual aria/label wiring.  
• Maintenance cost of React components is rated lower than Lit components without proof; depends on team skillset.  
• Performance implications (bundle size ~90 KB for Lit vs 230 KB for React + shadcn + ai-elements) were not measured.  
• File-attachment, model selector, session browser are treated as “we’ll build later” but counted as wins for Vercel; this skews the matrix.

---------------------------------------------------------------------
5. Production bite-points
---------------------------------------------------------------------
1. Bundle size jump could push you across 250 KB on cold load-time budgets → Core Web Vitals regress.  
2. If tool calls continue executing after a user presses Stop, you will burn provider tokens and confuse users with late messages.  
3. JSONL corruption: a single partial write (battery removal, tab close) creates an invalid tail; the session loader must tolerate/repair.  
4. Browser crashes on `indexedDB.quotaExceeded` manifest as transaction abort—currently uncaught.  
5. Lack of telemetry means you will discover the above only via user complaints.  
6. “Auto-compaction” may silently summarise sensitive info (API keys, passwords) into the system prompt; scrubber needed.  
7. Shadow-DOM removal means your CSS now leaks into host page; conflicts with marketing site styles possible.

---------------------------------------------------------------------
6. Specific recommendations / action items
---------------------------------------------------------------------
A. Validate `pi-coding-agent` browser build TODAY  
   • Run `npx browserify test.js` and see which Node core modules leak.  
   • Decide on SDK for browser vs proxying to backend.

B. Formalise the event contract  
   • Write an exhaustive state-machine for `message_start`, `text_delta`, `tool_call_start`, `tool_delta`, `tool_end`, `finish`, `error`, `abort`.  
   • Unit-test order permutations.

C. Abort propagation  
   • Implement `this.session.abortCurrentRun()` (or equivalent) when `abortSignal` fires.

D. Persistence hardening  
   • Add CRC footer per JSONL line; skip corrupt lines on reload.  
   • Cap total size per session; evict oldest branches.

E. File / model selector parity  
   • Spike the full feature before removal of pi-web-ui; expect 3-4 dev-days each incl. drag-and-drop, progress bar, resumable upload, security scanning.

F. Security  
   • Inject DOMPurify (or similar) into markdown renderer.  
   • Sanitize tool stdout (`<`, `>`, backticks).  
   • Generate expiring blob URLs and revoke after usage.

G. Observability  
   • Add instrumentation to `ChatTransport` (latency, error counts, token usage).  
   • Hook into existing metrics pipeline before GA.

H. Roll-back / feature flag  
   • Keep both stacks behind a remote config switch until >95 th percentile success for a week.  
   • Document manual rollback steps.

I. Performance budget  
   • Measure bundle diff with `webpack-bundle-analyzer`; set 10 % regression ceiling.  
   • Lazy-load AI Elements only on Chat route.

J. Accessibility audit  
   • Use `@axe-core/react` dev-hook and fix critical issues before launch.

---------------------------------------------------------------------
7. Revised timeline (realistic)
---------------------------------------------------------------------
• SDK/browser validation & polyfills..........1-2 d  
• Transport adapter incl. abort & retries......2 d  
• Event contract tests..........................1 d  
• React chat components........................3 d  
• File upload + model selector.................4 d  
• Session manager, compaction hardening........2 d  
• Security & XSS hardening.....................2 d  
• Observability & feature-flag rollout.........1 d  
• QA, accessibility, perf pass.................2 d  
TOTAL realistic................................18-19 dev-days (≈ 4 sprints with buffer)

---------------------------------------------------------------------
8. Conclusion
---------------------------------------------------------------------
Moving to Vercel AI SDK and pi-coding-agent is the right architectural direction, but the current plan underestimates compatibility work, feature parity, security, and operational readiness. Address the highlighted gaps, adopt a feature-flagged rollout, and budget roughly triple the stated effort to avoid painful surprises in production.
Tokens: 4228 in, 2839 out
