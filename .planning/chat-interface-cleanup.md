# Chat Interface Cleanup: Unified Agent Transport

**Status:** Phase 1-2 DONE, Phase 3 open — 2026-04-01
**Builds on:** `pi-migration-phase-ab.md` (completed)
**Reviewed by:** Codex (o3) — feedback incorporated

---

## Problem

The chat interface has 3 separate rendering paths, each with its own streaming logic, message format, and session management:

```
BEFORE (3 paths, 3 UIs):

Chat-centered shell (layouts/chat/)
  └─ useChatTransport(capabilities)       ← capability sniffing
       ├─ PiAgentCoreTransport             ← browser agent
       └─ DefaultChatTransport             ← server agent

Legacy DockView shell (shared/panels/)
  └─ AgentPanel (3-way conditional)
       ├─ PiNativeAdapter (857 lines)      ← pi-web-ui ChatPanel
       ├─ PiBackendAdapter (516 lines)     ← custom SSE streaming
       └─ AiChat (299 lines)              ← own useChat + DefaultChatTransport
```

---

## Architecture (target)

```
  config.agents.mode = 'frontend' | 'backend'
  URL override: ?agent_mode=frontend|backend (dev only)

  useAgentTransport()                        ← shared/providers/agent/
    ├─ 'frontend' → PiAgentCoreTransport     ← browser tools + session API keys
    └─ 'backend'  → DefaultChatTransport     ← /api/v1/agent/chat + workspace scope
                         │
                    useChat({ transport })    ← @ai-sdk/react
                         │
                    ChatStage / ChatMessage / ChatComposer
                         │
              ┌──────────┴──────────┐
              │                     │
    Chat-centered shell    Legacy DockView shell
    (layouts/chat/)        (shared/panels/AgentPanel)
```

---

## Frontend Structure (post-refactor)

```
src/front/
  App.jsx                                   ← shell routing, dev banner
  layouts/
    chat/
      ChatCenteredWorkspace.jsx             ← orchestrator (uses useAgentTransport)
      ChatStage.jsx                         ← message list + composer container
      NavRail.jsx                           ← left icon strip
      BrowseDrawer.jsx                      ← session history drawer
      SurfaceShell.jsx                      ← right workbench
      SurfaceDockview.jsx                   ← DockView inside Surface
      useChatCenteredShell.js               ← ?shell= feature flag
      layout.css                            ← shell styles + API key prompt
      components/
        ChatComposer.jsx                    ← input + model selector + thinking toggle
        ChatMessage.jsx                     ← message part renderer
        ApiKeyPrompt.jsx                    ← inline key entry (frontend mode)
      hooks/
        useSessionState.js                  ← session store (localStorage)
        useArtifactController.js            ← Surface artifact lifecycle
        useToolBridge.js                    ← window bridge for PI tools
        useShellPersistence.js              ← layout state persistence
        useShellStatePublisher.js           ← state → backend sync
  shared/
    providers/
      agent/
        useAgentTransport.js                ← config-driven transport hook ← NEW
        index.js                            ← barrel export ← NEW
      pi/
        piAgentCoreTransport.js             ← browser agent bridge (MODIFIED)
        defaultTools.js                     ← tool definitions
        agentConfig.js                      ← child app tool extension
        envApiKeys.browser.js               ← API key resolution from env
        useChatTransport.js                 ← OLD (replaced by useAgentTransport)
        nativeAdapter.jsx                   ← OLD (857 lines, legacy only)
        backendAdapter.jsx                  ← OLD (516 lines, legacy only)
      data/
        DataContext.js                      ← useDataProvider hook
    panels/
      AgentPanel.jsx                        ← legacy shell agent routing
    components/
      chat/
        AiChat.jsx                          ← OLD (299 lines, legacy only)
        chat-stage.css                      ← chat styles (thinking + model selector)
    config/
      appConfig.js                          ← agents.mode config
    design-system/
      base.css                              ← dev banner styles
```

---

## Config

```javascript
// shared/config/appConfig.js
agents: {
  mode: 'frontend',   // 'frontend' | 'backend'
}
```

Dev URL override: `?agent_mode=frontend` or `?agent_mode=backend`

Dev banner (all modes, dev only): shows `{shell} · agent:{mode}` at top center

---

## Phase 1: Transport layer + chat-centered shell — DONE

**Created:**
| File | Purpose |
|------|---------|
| `shared/providers/agent/useAgentTransport.js` | Config-driven transport, workspace scoping, session API keys, model/thinking controls |
| `shared/providers/agent/index.js` | Barrel export |

**Modified:**
| File | Change |
|------|--------|
| `layouts/chat/ChatCenteredWorkspace.jsx` | `useAgentTransport()` replaces `useChatTransport(capabilities)`, removed CapabilitiesContext |
| `layouts/chat/__tests__/ChatCenteredWorkspace.test.jsx` | Updated mock path |
| `App.jsx` | Dev mode banner |
| `shared/design-system/base.css` | `.dev-mode-banner` styles |

**Key decisions:**
- `resolveAgentMode()` checks `?agent_mode=` URL param first, then `config.agents.mode`
- Frontend transport: ref-stable (preserves Agent state), tools updated via `updateTools()`
- Backend transport: `useMemo` keyed on `workspaceId` (recreates on workspace change)
- `messages: sessionMessages` preserved in useChat (Codex review catch)
- `resolveApiKey()` checks env vars first, then session key store

---

## Phase 2: Feature parity — DONE

**Created:**
| File | Purpose |
|------|---------|
| `layouts/chat/components/ApiKeyPrompt.jsx` | Inline API key entry, stores via `setSessionApiKey()` |

**Modified:**
| File | Change |
|------|--------|
| `shared/providers/pi/piAgentCoreTransport.js` | Added `setThinkingLevel()`, `setModel()`, `getAvailableModels()`, `_selectedModel`, `_thinkingLevel` |
| `layouts/chat/components/ChatComposer.jsx` | Thinking toggle (Brain icon, cycles off→low→high), model selector dropdown (available models, "No key" badge) |
| `layouts/chat/ChatStage.jsx` | Props threading: thinkingLevel, model, agentMode |
| `layouts/chat/ChatCenteredWorkspace.jsx` | Wires all controls from useAgentTransport → ChatStage → ChatComposer |
| `shared/components/chat/chat-stage.css` | `.vc-thinking-toggle`, `.vc-model-selector`, `.vc-model-menu` styles |
| `layouts/chat/layout.css` | `.vc-apikey-prompt` styles |

**Skipped:**
- XML tool normalization — edge case, deferred
- Session persistence bridge (localStorage → IndexedDB) — needs investigation, not blocking

**Feature visibility:**
- Model selector + thinking toggle: only visible when `agentMode === 'frontend'`
- API key prompt: only shown when error matches `/api key/i` in frontend mode
- Backend mode: these controls hidden (server manages model/keys)

---

## Phase 3: Wire legacy shell + deprecate adapters — OPEN

**Prerequisite:** Validate Phases 1-2 in production first.

**Modify:**
| File | Change |
|------|--------|
| `shared/panels/AgentPanel.jsx` | Replace 3-way routing with `useChat` + `useAgentTransport` + `ChatStage` |

**Session controller (from Codex review):**
AgentPanel passes `panelId`, `sessionBootstrap`, `piInitialSessionId` into panel-scoped session machinery. Rewrite needs either:
- `useAgentSessionController` hook covering these flows, OR
- Simplified session logic if DockView panel splitting is no longer needed

**Deprecate (mark `@deprecated`, do not delete):**
| File | Lines | Replaced by |
|------|-------|-------------|
| `shared/providers/pi/nativeAdapter.jsx` | 857 | useChat + PiAgentCoreTransport |
| `shared/providers/pi/backendAdapter.jsx` | 516 | useChat + DefaultChatTransport |
| `shared/components/chat/AiChat.jsx` | 299 | useChat + DefaultChatTransport |
| `shared/providers/pi/useChatTransport.js` | 73 | useAgentTransport |

**Verify:**
- All 4 URLs work:
  - `?shell=chat-centered&agent_mode=frontend`
  - `?shell=chat-centered&agent_mode=backend`
  - `?shell=legacy&agent_mode=frontend`
  - `?shell=legacy&agent_mode=backend`
- `npm run test:run` — green

---

## Open Items

| Item | Priority | Notes |
|------|----------|-------|
| Session persistence (localStorage vs IndexedDB) | Medium | useSessionState uses localStorage, pi-web-ui uses IndexedDB. Migration path TBD. |
| XML tool normalization | Low | Edge case for LLMs that emit XML tool calls. `toolCallXmlTransform.js` exists but not wired into transport. |
| AgentPanel rewrite (Phase 3) | Blocked | Needs Phases 1-2 validated in production first. |
| Streaming edge cases | Medium | PiAgentCoreTransport tested with unit tests, needs real-world validation. |

---

## Tests

150/150 passing (`src/front/layouts/chat/`).
