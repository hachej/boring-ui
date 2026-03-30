# PI Coding Agent + Vercel AI SDK Chat Migration Plan

## Status

Draft v2 - 2026-03-28 (incorporates o3 architectural review)

Companion to: `docs/plan/codex-chat-centered-surface-redesign.md`

---

## Decision

Replace `pi-agent-core` + `pi-web-ui` with `pi-coding-agent` SDK + Vercel AI SDK `useChat` frontend.

```
CURRENT STACK:
  pi-web-ui (Lit/Shadow DOM)  →  pi-agent-core (Agent class)  →  pi-ai (providers)
  ↑ renders chat                  ↑ agent loop + tools            ↑ model routing
  300+ lines CSS hacks            manual session persistence      multi-provider
  shadow DOM isolation            no compaction
  can't integrate with Surface    no branching

TARGET STACK:
  Vercel useChat (React)      →  transport layer (mode-dependent) →  pi-ai (providers)
  ↑ renders chat                  ↑ see below                       ↑ same
  full React composition
  Surface integration
  AI Elements components
  custom tool rendering

TRANSPORT BY MODE:
  BROWSER:  useChat → PiAgentCoreTransport → pi-agent-core (Agent class, in-browser)
            Tools call boring-ui backend API for file/git/bash ops (same as today)
            Sessions: IndexedDB (same as today, via our adapter)
            No compaction, no branching (pi-agent-core doesn't have them)

  SERVER:   useChat → DefaultChatTransport → /api/v1/agent/chat → pi-coding-agent
            Tools execute server-side (fs, bash, git — native Node)
            Sessions: JSONL with compaction + branching
            Full pi-coding-agent features
```

### Critical Finding: pi-coding-agent is Node-only

Validated 2026-03-28: `pi-coding-agent` v0.63.1 has **50+ Node built-in imports** across core files (`fs`, `path`, `child_process`, `os`, `crypto`, `events`, `readline`). Every tool (`bash.js`, `grep.js`, `find.js`, `ls.js`, `read.js`, `write.js`, `edit.js`), the session manager, auth storage, resource loader, and event bus all use Node APIs directly. No browser field, no polyfills, no conditional imports.

`pi-agent-core` v0.63.1 has **zero Node built-in imports** and is browser-safe.

This means compaction, branching, JSONL sessions, and built-in coding tools are **server-mode only** features. Browser mode must continue using `pi-agent-core` with our existing `defaultTools.js` (which route file/git/bash operations through the boring-ui backend API).

---

## Evaluation: Vercel AI SDK vs PI Web UI

### PI Web UI (`@mariozechner/pi-web-ui`)

**What it is**: Lit-based web components (ChatPanel, MessageEditor, ArtifactPanel) using Shadow DOM + Tailwind CSS v4.

**Strengths**:
- Drop-in chat widget — zero setup for basic chat
- Built-in artifact rendering (HTML, SVG, Markdown in sandboxed iframes)
- Built-in model selector dialog
- Built-in file attachment support (PDF, DOCX, XLSX, PPTX, images)
- IndexedDB-backed storage for sessions, API keys, settings
- Automatic CORS proxy handling for browser environments
- Tightly coupled with pi-agent-core — events wire up automatically

**Weaknesses for Stage+Wings**:
- **Shadow DOM isolation** — CSS changes require 300+ lines of selector hacks targeting internal DOM structure. Every pi-web-ui update can break these.
- **Can't compose with React** — artifact cards in chat can't interact with Surface state, hooks, or context. No way to call `useArtifactState().open()` from inside the shadow DOM.
- **We hide its own features** — `artifacts-panel { display: none !important }` because we have the Surface. The artifact system is wasted.
- **Styling fights** — we bridge 40+ CSS variables from boring-ui tokens → shadcn tokens → pi-web-ui tokens. Three layers of indirection.
- **No message-level control** — can't inject custom artifact cards, provenance badges, three-state highlighting, or avatar rendering into the message timeline.
- **Lit class field shadowing** — requires `fixLitClassFieldShadowing()` hack (60 lines) to work with React.
- **Session management is internal** — can't easily control sessions from the chat stage shell; everything routes through the web component API.

**Verdict**: Excellent for standalone chat widgets. Wrong choice for a deeply integrated shell where chat must compose with Surface, artifacts, and session state.

### Vercel AI SDK (`useChat` + AI Elements)

**What it is**: React hooks (`useChat`, `sendMessage`, `status`, `stop`) + optional prebuilt components (AI Elements, 20+ components on shadcn/ui).

**Strengths for Stage+Wings**:
- **Full React composition** — messages are plain React components. Can inject artifact cards, provenance badges, custom tool renderers, Surface-opening behaviors.
- **`message.parts` typed array** — text, reasoning, tool-call, tool-result, dynamic-tool parts. Each part is individually renderable.
- **Custom transport** — `ChatTransport.sendMessages()` is pluggable. Can wrap pi-coding-agent, hit a backend, or go direct to provider.
- **Status management** — `status` gives `'submitted' | 'streaming' | 'ready'`. Maps directly to UI states (thinking indicator, stop button, send button).
- **AI Elements** — 20+ production-ready shadcn/ui components for AI interfaces. MessageResponse handles streaming markdown. Tool component renders tool execution. Already uses shadcn/ui which boring-ui already has.
- **State decoupling** — can integrate with Zustand, context, or any state store. Chat state, Surface state, and shell state can coordinate.
- **Streaming protocol** — SSE-based, debuggable in browser dev tools.
- **Tool rendering** — already have custom `toolRenderers.jsx` in boring-ui. Full control over how each tool result appears.

**Weaknesses**:
- No built-in model selector (need to build or use AI Elements)
- No built-in file attachment UI (need to build)
- No built-in session persistence (pi-coding-agent handles this)
- More assembly required vs drop-in widget

**Verdict**: Right choice for a shell where chat is the command center and must deeply integrate with artifact state, Surface, and custom rendering.

### Decision Matrix

| Capability | pi-web-ui | Vercel useChat | Winner |
|---|---|---|---|
| Artifact card rendering in chat | Can't customize (shadow DOM) | Full React control | **Vercel** |
| Surface integration | Impossible across shadow boundary | Direct hook composition | **Vercel** |
| Three-state artifact highlights | Would need shadow DOM piercing | CSS class on React element | **Vercel** |
| Provenance badges | Can't inject | Custom message part | **Vercel** |
| Tool call rendering | Built-in (can't customize) | Custom React components | **Vercel** |
| Streaming status | Internal (can't observe) | `status` hook value | **Vercel** |
| Stop button | Internal | `stop()` function | **Vercel** |
| Model selector | Built-in dialog | Need to build | pi-web-ui |
| File attachments | Built-in (PDF, DOCX, etc.) | Need to build | pi-web-ui |
| Drop-in simplicity | Excellent | More assembly | pi-web-ui |
| Session management | IndexedDB internal | Delegated to transport/backend | pi-web-ui |
| shadcn/ui consistency | Own token system | Native shadcn/ui | **Vercel** |
| Accessibility | Lit defaults | React + shadcn/ui defaults | **Vercel** |
| Long-term maintainability | CSS hacks on every update | Standard React components | **Vercel** |

**Score**: Vercel wins 10-3 for the Stage+Wings use case. pi-web-ui wins on features we either don't need (artifacts panel — we have the Surface) or can build incrementally (model selector, file attachments).

---

## Upgrade: pi-agent-core → pi-coding-agent SDK

### What pi-coding-agent adds over pi-agent-core

| Feature | pi-agent-core (current) | pi-coding-agent SDK |
|---|---|---|
| Agent loop + tool execution | `new Agent()` + manual tools | `createAgentSession()` — tools built-in |
| Session persistence | Manual IndexedDB in nativeAdapter (150 lines) | **Built-in JSONL auto-save** |
| Context compaction | None — sessions hit context limit | **Auto-compaction with lossy summarization** |
| Context overflow recovery | None — crashes | **Auto-retry with compacted context** |
| Conversation branching | None | **Tree-based branching with parentId** |
| Coding tools | Reimplemented in defaultTools.js (200+ lines) | **Built-in, battle-tested** (file, bash, git, search) |
| Project context | None | **Reads .pi context files** |
| Extensions/skills | None | **ResourceLoader for extensions** |
| Custom tools | Manual tool array | **Merge custom + built-in tools** |

### What we delete

| File | Lines | Reason |
|---|---|---|
| `src/front/providers/pi/nativeAdapter.jsx` | 857 | Shadow DOM mounting, Lit hacks, session persistence — all replaced |
| `src/front/providers/pi/defaultTools.js` | — | **KEEP for browser mode** — pi-agent-core needs custom tools. Restructure into `tools/` directory but do not delete. |
| `src/front/providers/pi/chatPanelTools.js` | ~100 | ChatPanel-specific tool filtering — no more ChatPanel |
| `src/front/providers/pi/toolCallXmlTransform.js` | ~150 | XML tool message normalization for pi-web-ui — not needed |
| `src/front/providers/pi/authErrorRecovery.js` | ~80 | Provider auth recovery tied to pi-web-ui prompt flow |
| `@mariozechner/pi-web-ui` dependency | — | Replaced by Vercel useChat |
| `@mariozechner/mini-lit` dependency | — | Only needed for pi-web-ui |

**NOT deleted** (needed for browser mode):
- `defaultTools.js` — browser mode tools routing through backend API
- `@mariozechner/pi-agent-core` — browser mode agent runtime (must stay as explicit dependency, not just transitive)

**Total deleted**: ~1100+ lines of adapter/bridge/hack code (nativeAdapter, chatPanelTools, toolCallXmlTransform, authErrorRecovery).

### What we keep

| File | Reason |
|---|---|
| `src/front/providers/pi/sessionBus.js` | Session coordination — refactor to use pi-coding-agent sessions |
| `src/front/providers/pi/config.js` | PI runtime config (backend mode detection) |
| `src/front/providers/pi/agentConfig.js` | Agent config (system prompt, model selection) |
| `src/front/providers/pi/runtime.js` | PI runtime singleton — adapt for pi-coding-agent |
| `src/front/providers/pi/uiBridge.js` | UI bridge tools (open_file, list_tabs) — keep as custom tools |

### What we build

| File | Purpose | Lines (est.) |
|---|---|---|
| `src/front/providers/pi/piCodingAgentTransport.js` | `ChatTransport` wrapping `createAgentSession()` | ~80 |
| `src/front/shell/ChatStage.jsx` | Chat stage container using `useChat` + custom transport | ~120 |
| `src/front/shell/ChatMessage.jsx` | Message renderer (avatars, text, tool cards, artifact cards) | ~150 |
| `src/front/shell/ChatComposer.jsx` | Pill-shaped composer with kbd hints, stop/send buttons | ~60 |
| `src/front/shell/ToolCallCard.jsx` | Inline tool execution card (icon, name, status, result) | ~80 |
| `src/front/shell/ArtifactCard.jsx` | Clickable artifact card (three-state, chevron, Surface integration) | ~60 |
| `src/front/shell/StreamingArtifact.jsx` | Pending/streaming state for artifacts being written by agent | ~40 |

**Total new**: ~550 lines, well-structured React components.

**Net savings**: ~850 lines deleted.

---

## Transport Architecture

### Browser mode (pi-agent-core + custom tools via backend API)

```js
// Browser mode uses pi-agent-core (0 Node imports, browser-safe)
// Tools are our custom defaultTools.js which call boring-ui backend API
// for file/git/bash operations — same pattern as today, minus the shadow DOM wrapper
import { Agent } from '@mariozechner/pi-agent-core'

class PiAgentCoreTransport {
  constructor(tools, agentConfig) {
    this.tools = tools        // our custom defaultTools.js (file ops via backend API)
    this.agentConfig = agentConfig
    this.agent = null
  }

  async sendMessages({ messages, abortSignal }) {
    if (!this.agent) {
      this.agent = new Agent({
        initialState: {
          systemPrompt: this.agentConfig.systemPrompt,
          model: this.agentConfig.model,
          tools: this.tools,      // custom tools calling boring-ui backend
          messages: [],
        },
      })
    }

    const lastUserMessage = messages.filter(m => m.role === 'user').pop()
    const text = lastUserMessage?.content || ''

    // Return a ReadableStream of AI SDK UI message chunks
    return new ReadableStream({
      start: (controller) => {
        let textPartId = `text-${Date.now()}`
        let textStarted = false

        const unsubscribe = this.agent.subscribe((event) => {
          switch (event.type) {
            case 'message_update':
              if (event.assistantMessageEvent?.type === 'text_delta') {
                if (!textStarted) {
                  controller.enqueue({ type: 'text-start', id: textPartId })
                  textStarted = true
                }
                controller.enqueue({
                  type: 'text-delta',
                  id: textPartId,
                  delta: event.assistantMessageEvent.delta
                })
              }
              // TODO: handle tool_call_start, tool_delta, tool_end events
              break

            case 'message_end':
              if (textStarted) {
                controller.enqueue({ type: 'text-end', id: textPartId })
                textStarted = false
                textPartId = `text-${Date.now()}`  // reset for next turn
              }
              break

            case 'agent_end':
              controller.enqueue({ type: 'finish' })
              controller.close()
              unsubscribe()
              break
          }
        })

        this.agent.run(text).catch(err => {
          controller.error(err)
          unsubscribe()
        })

        abortSignal?.addEventListener('abort', () => {
          // TODO: propagate abort to agent.abort() when available
          unsubscribe()
          controller.close()
        })
      }
    })
  }

  async reconnectToStream() { return null }
}
```

### Server mode (pi-coding-agent via backend)

```js
import { DefaultChatTransport } from 'ai'

// Server mode: boring-ui backend runs pi-coding-agent (Node-only)
// Gets: compaction, branching, JSONL sessions, built-in coding tools (real fs/bash/git)
// Already works — this is what AiChat.jsx does today
const transport = new DefaultChatTransport({
  api: buildApiUrl('/api/v1/agent/chat'),
  credentials: 'include',
})
```

### Mode selection

```jsx
function useChatTransport(capabilities) {
  const defaultTools = useDefaultTools()  // our custom tools calling backend API
  const agentConfig = usePiAgentConfig()

  return useMemo(() => {
    if (isPiBackendMode(capabilities)) {
      // SERVER MODE: pi-coding-agent on backend
      // Compaction, branching, JSONL sessions, native file/bash/git tools
      return new DefaultChatTransport({
        api: buildApiUrl('/api/v1/agent/chat'),
        credentials: 'include',
      })
    }
    // BROWSER MODE: pi-agent-core in-browser
    // Custom tools route file/git/bash ops through boring-ui backend API
    // No compaction, no branching (pi-agent-core doesn't have them)
    return new PiAgentCoreTransport(defaultTools, agentConfig)
  }, [capabilities, defaultTools, agentConfig])
}
```

---

## Methodology: Test-Driven Development

Every phase follows TDD: write failing tests first, then implement until tests pass, then refactor.

Test stack:
- **Unit tests**: Vitest for transport event mapping, artifact model, session state logic
- **Component tests**: Vitest + React Testing Library for ChatMessage, ChatComposer, ToolCallCard, ArtifactCard
- **Integration tests**: Playwright for end-to-end flows (send message → stream → artifact opens)
- **Security tests**: Vitest for DOMPurify integration, XSS vectors, HTML entity escaping

TDD cycle per phase:
1. Write test file(s) covering the phase's success criteria
2. Run tests — confirm they fail (red)
3. Implement the minimum code to pass (green)
4. Refactor for quality (refactor)
5. Tests must pass before the phase is considered done

---

## Execution Plan

### Phase A: Verify SDK compatibility

**Tests first:**
- `tests/unit/test_pi_agent_core_browser.test.js` — import `Agent` from pi-agent-core, verify it constructs in jsdom env with zero Node errors
- `tests/unit/test_pi_coding_agent_server.test.js` — import `createAgentSession`, verify construction in Node

**Then implement:**
1. `npm install @mariozechner/pi-coding-agent`
2. Verify pi-agent-core `Agent` works in browser context (Vitest jsdom)
3. Verify `createAgentSession()` works server-side
4. Verify compatibility with existing pi-ai provider setup

### Phase B: Build PiAgentCoreTransport

**Tests first:**
- `tests/unit/test_pi_event_mapper.test.js`:
  - PI `message_update` (text_delta) → AI SDK `text-start` + `text-delta` chunks
  - PI `message_end` → AI SDK `text-end` chunk
  - PI `agent_end` → AI SDK `finish` chunk
  - Interleaved text + tool events maintain correct ordering
  - AbortSignal cancellation closes the stream
  - Error during agent.run() propagates as stream error
- `tests/unit/test_transport_selection.test.js`:
  - Browser mode → `PiAgentCoreTransport`
  - Server mode → `DefaultChatTransport`

**Then implement:**
1. `src/front/providers/pi/piAgentCoreTransport.js` — `sendMessages()` returning `ReadableStream<UIMessageChunk>`
2. PI event → AI SDK chunk mapping (exhaustive state machine)
3. Abort handling via AbortSignal
4. `useChatTransport()` hook for mode selection

### Phase C: Build chat stage React components

**Tests first:**
- `tests/components/ChatMessage.test.jsx` — user/agent avatars, text parts, tool-call parts, reasoning parts
- `tests/components/ChatComposer.test.jsx` — pill shape, kbd hints, send disabled when empty, stop when streaming, Enter submits
- `tests/components/ToolCallCard.test.jsx` — spinner/check/error states, tool name + path display
- `tests/components/ArtifactCard.test.jsx` — three visual states (default/open/active), click fires callback, chevron

**Then implement:**
1. `ChatStage.jsx` — `useChat` + transport selection
2. `ChatMessage.jsx` — renders `message.parts`
3. `ChatComposer.jsx` — pill input, kbd hints, stop/send
4. `ToolCallCard.jsx` — tool execution card
5. `ArtifactCard.jsx` — three-state, wired to Surface
6. `StreamingArtifact.jsx` — pending/streaming state
7. Style matching Stage+Wings design tokens (from POC `poc-stage-wings/src/vercel-pi-chat.css`)

### Phase D: Wire session management

**Tests first:**
- `tests/unit/test_session_state.test.js` — switch changes activeSessionId, switch preserves Surface artifacts, new session creates fresh ID, list sorted by recency

**Then implement:**
1. Adapt `sessionBus.js` to use pi-coding-agent `SessionManager` (server) or IndexedDB adapter (browser)
2. Session switching reinitializes `useChat` via `id` prop
3. New session creates a fresh session
4. Compaction automatic in server mode

### Phase E: Wire UI bridge tools + tool→artifact bridge

**Tests first:**
- `tests/unit/test_tool_artifact_bridge.test.js` — `write_file` result → artifact controller `open()`, `read_file` → no call, same file twice → `focus()` not duplicate `open()`

**Then implement:**
1. Keep `open_file`, `list_tabs`, `open_panel` as custom tools
2. Register via pi-agent-core tool array (browser) or pi-coding-agent merge API (server)
3. Tool renderers fire side-effects into artifact controller (see Plan 1 Architecture I bridge pattern)
4. Artifact-producing tools auto-open Surface; non-artifact tools render inline only

### Phase F: Security hardening + cleanup

**Tests first:**
- `tests/unit/test_xss_sanitization.test.js` — `<script>alert(1)</script>` stripped, `<img onerror>` stripped, HTML entities escaped, dashboard HTML in sandboxed iframe
- `tests/unit/test_blob_lifecycle.test.js` — blob URL created on mount, revoked on unmount

**Then implement:**
1. Add DOMPurify to all markdown/HTML rendering
2. Dashboard renderers: sandboxed iframe (`sandbox="allow-scripts"`, NOT `allow-same-origin`)
3. Sanitize tool stdout/stderr (escape HTML entities)
4. Blob URL lifecycle: create on mount, revoke via useEffect cleanup
5. Remove `nativeAdapter.jsx`, `chatPanelTools.js`, `toolCallXmlTransform.js`, `authErrorRecovery.js`
6. Remove `@mariozechner/pi-web-ui` and `@mariozechner/mini-lit` from package.json
7. **KEEP** `defaultTools.js` (restructure into `tools/`) and `@mariozechner/pi-agent-core`

### Phase G: Model selector + file attachments

**Tests first:**
- `tests/components/ModelSelector.test.jsx` — renders models, selection updates config, current model shown
- `tests/components/FileAttachment.test.jsx` — drag-and-drop zone, stored in OPFS not IndexedDB, blob URL revoked on unmount
- `tests/unit/test_file_storage.test.js` — 10MB file → OPFS, IndexedDB has metadata only, quota exceeded → graceful error

**Then implement:**
1. Model selector (dropdown or command palette)
2. File attachment UI — drag-and-drop + button + preview
3. File storage: OPFS/Cache API for blobs, IndexedDB for metadata only
4. Expiring blob URLs with useEffect cleanup

---

## Risks And Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **pi-coding-agent is Node-only** | CONFIRMED | Browser mode uses pi-agent-core; pi-coding-agent is server-only. Architecture already accounts for this. |
| createAgentSession API changes (0.x package) | Medium | Pin version, wrap in our own adapter layer |
| Tool call events interleave with text deltas | Medium | Build exhaustive state machine for event ordering; unit test permutations |
| **Abort doesn't propagate to agent loop** | High | Implement `agent.abort()` or equivalent when AbortSignal fires. Without this, Stop button burns tokens silently. |
| Compaction rewrites message IDs | Medium | Artifact provenance uses canonical keys (file path, review ID), not message IDs |
| **XSS from unsandboxed markdown** | High | pi-web-ui used sandboxed iframes; Vercel useChat does not. Inject DOMPurify into markdown renderer. Sanitize tool stdout (`<`, `>`, backticks). |
| Multi-tab concurrency on IndexedDB sessions | Medium | Add last-writer-wins detection or lock via `proper-lockfile` pattern for browser storage |
| JSONL corruption on partial writes (tab close) | Medium | Add CRC footer per line; skip corrupt lines on reload |
| IndexedDB quota (~50MB per origin) | High | **Do not store file attachments in IndexedDB.** Use Origin Private File System (OPFS) or Cache API for binary blobs (PDF, images). IndexedDB stores only session metadata + message text. |
| Browser mode context overflow (no compaction) | Medium | Transport estimates token usage before sending. UI shows context usage indicator. Warn at 80% of model's context window. Server mode handles this via pi-coding-agent compaction. |
| `useChat` does not support tree-based branching | Medium | **Drop branching from v1 scope.** `useChat` manages linear message arrays only. Branching would require bypassing `useChat` state management entirely. Revisit post-v1 if demand exists. |
| **Telemetry regression** | Medium | pi-web-ui had built-in analytics. Add instrumentation to ChatTransport (latency, error counts, token usage) before GA. |
| Bundle size regression (Lit ~90KB → React+shadcn+AI Elements ~230KB) | Medium | Measure with bundle analyzer; lazy-load AI Elements only on chat route; set 10% regression ceiling |
| Missing features: model selector, file attachments | Medium | Phase G — build after core migration but BEFORE removing pi-web-ui |
| No rollback path | High | Single feature flag `features.chatCenteredShell` controls both shell + chat migration (not two separate flags). Keep pi-web-ui code until post-GA cleanup. Old shell remains fallback until stable. |

---

## Security Requirements (from o3 review)

- **Markdown rendering**: DOMPurify on all assistant markdown. pi-web-ui used sandboxed iframes; without that, raw HTML from the model can XSS.
- **Tool output**: Sanitize shell stdout/stderr (`<`, `>`, backticks, HTML entities).
- **File attachments**: Generate expiring blob URLs; revoke after usage. Don't leak blob URLs.
- **Compaction privacy**: Auto-compaction may summarize sensitive info (API keys, passwords) into the system prompt. Consider a scrubber for known patterns.

## Observability Requirements (from o3 review)

- Instrument `ChatTransport.sendMessages()`: latency, error counts, token usage per session
- Track: first message latency, stream duration, tool call count, compaction events
- Hook into existing boring-ui metrics pipeline before GA
- Replace pi-web-ui's built-in telemetry that we're removing

## Rollback Plan

1. Both stacks coexist behind single `features.chatCenteredShell` flag (same flag as Plan 1 — shell + chat migrate together)
2. Flag defaults to OFF in production
3. Enable for internal testing first
4. Model selector and file attachments must land BEFORE flag flip
5. Monitor error rate, latency, and user complaints for 1 week
6. Only remove pi-web-ui after stable GA rollout (post-GA cleanup step)
7. Document manual rollback: flip flag off, old shell + pi-web-ui chat render immediately

---

## Timeline (revised per o3 review)

| Phase | Description | Effort |
|---|---|---|
| A | Verify pi-coding-agent server-side; confirm pi-agent-core browser transport | 1 day |
| B | Build transport adapters (browser + server) + event state machine + abort | 2 days |
| B.1 | Event contract unit tests (ordering, interleaving, errors) | 1 day |
| C | Build chat stage React components | 3 days |
| D | Wire session management (browser: IndexedDB adapter; server: pi-coding-agent) | 1.5 days |
| E | Wire UI bridge tools + artifact card integration | 1 day |
| F | Security hardening (DOMPurify, blob cleanup, output sanitization) | 1.5 days |
| G | Model selector + file attachments (parity features) | 3-4 days |
| H | Observability instrumentation | 1 day |
| I | Feature flag rollout + testing + pi-web-ui removal | 1.5 days |
| J | Accessibility audit (axe-core) + performance budget validation | 1.5 days |
| **Total** | | **18-20 days** |

Note: Original estimate was 6-8 days. o3 review correctly identified this as 2-3x underestimated due to missing security, observability, parity features, and hardening work.

---

## Sources

- [pi-coding-agent SDK docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)
- [pi-coding-agent compaction docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/compaction.md)
- [pi-web-ui DeepWiki](https://deepwiki.com/badlogic/pi-mono/6-@mariozechnerpi-web-ui)
- [pi-agent-core DeepWiki](https://deepwiki.com/badlogic/pi-mono/3-@mariozechnerpi-agent-core)
- [AI SDK Transport docs](https://ai-sdk.dev/docs/ai-sdk-ui/transport)
- [AI SDK useChat reference](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat)
- [AI Elements announcement](https://vercel.com/changelog/introducing-ai-elements)
- [AI SDK 6 blog](https://vercel.com/blog/ai-sdk-6)
- [pi-mono GitHub](https://github.com/badlogic/pi-mono)
- [pi-coding-agent SDK examples](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples)
