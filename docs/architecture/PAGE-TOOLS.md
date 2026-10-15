# Placement and page tools

Status: proposed, 2026-10-15. Section 1 (placement) is to build. Section 2 (page tools) is specified only. This document refines the "page commands" surface of [WEBSITE-INTEGRATION.md](WEBSITE-INTEGRATION.md).

An agent beside a page needs three things, each with one mechanism:

| Need | Mechanism | Status |
| --- | --- | --- |
| Where the person is | **Screen context**: a screen calls `useAgentContext({ name, params })` (`registry/app-shell/agent-context.ts`); the browser sends it with each submit (`useRemoteChat({ requestContext: readAgentContext })`); the server receives it (`createChatTransportHandler`'s `requestContext`) and renders it per request with `createPromptContext` (`@hachej/boring-agent/prompt-context`), never stored in the transcript | Exists |
| How the agent is placed (docked or floating) | **Placement**, added to the same context | To build (section 1) |
| Act on the page (show, navigate, fill) | **Page tools**: WebMCP tools the page registers | Specified, deferred (section 2) |
| Change data | The application's backend actions, with receipts | Exists (host operations) |

The library defines no verbs of its own (navigate, highlight, prefill…) and no page-specific tool format.

## 1. Placement

### 1.1 Shape

The same chat is either **docked** (`PiChat` in a `Dock` or `ArtifactWorkspace`) or **floating** (`AmbientChat`, including a docked chat floated by its divider, and the `AgentLayer` over the app: the phone drawer and the wide-screen panel). The component that sends a submit adds its placement to the request context:

```json
{ "name": "invoice", "params": { "id": 42 }, "placement": "docked" }
```

`placement` is `docked` or `floating`, set by the component, never by the host or the model. It is added beside today's `readAgentContext()` fields (`name`, `params`), which stay flat and unchanged, so existing hosts keep reading them.

### 1.2 The agent's role per placement

| | `docked` | `floating` |
| --- | --- | --- |
| Who drives | **The agent is primary.** The conversation is the main surface; the viewer beside it shows its work. | **The person is primary.** The application owns the page; the agent assists beside it. |
| Navigation | Happens **in the viewer**: the agent opens pages, records and files in it as part of answering, without being asked. | The agent **does not move the page** unless asked. It answers about what is on screen and suggests where to go. |
| Answers | May be longer; say what was opened in the viewer. | Short; about what the person is looking at. |

The library ships these two role descriptions as a default instruction fragment (a `PromptSection`, since it changes rarely), which the host includes and may rewrite. The per-request context only carries the current value.

### 1.3 Laws

- **PLACE-1: placement is reported, not inferred.** The sending component sets it. Floating or docking takes effect at the next request.
- **PLACE-2: placement changes behaviour, never authority.** A docked agent may open things more freely; it may not write more. Saving stays a backend action or a person's click in both placements. Like all request context, it is advisory text, not policy.
- **PLACE-3: one conversation across placements.** Floating and docking keep the controller, transcript, queue and draft (as `Dock` and `ArtifactWorkspace` already do); only the context's `placement` changes.

## 2. Page tools (WebMCP), specified, deferred

### 2.1 Model

A page that wants the agent to act on it registers tools with [WebMCP](https://webmachinelearning.github.io/webmcp/): name, description, JSON Schema input, `execute`. The tool set follows the page: a screen registers its tools when it mounts and aborts them when it unmounts, so the agent sees `open_invoice` on the invoice list and `fill_payment_form` on an invoice, and nothing on a screen that registers nothing. The agent discovers tools from where the person is, request by request; there is no global list.

The same registrations serve two consumers: our agent (server-side) through the chat's bridge (2.2), and a browser agent through the browser's native WebMCP where it exists.

The page uses the standard API through a polyfill (`@mcp-b/global` or its successor): the API is a Community Group draft, implemented only in Chrome, and still moving (`navigator.modelContext` → `document.modelContext`, unregistration by `AbortSignal`). The polyfill absorbs that churn, not the library. Verify these details against the draft before building.

### 2.2 The bridge

- At each submit, the chat sends the screen's registered tools (names, descriptions, schemas) next to the request context. The server offers them to the agent for that request only.
- A call goes to the page over the conversation stream, runs the registered `execute`, and returns its result: the same round trip as a question answered in the browser.
- The call carries the registration it was offered from. If that registration was aborted since (the person navigated, the viewer closed), the result is `unavailable`, never an execution on whatever screen is current.
- With no page connected (browser closed, headless run), page tools are absent; backend actions still work.

### 2.3 Laws

- **PAGE-1: a page tool is presentation.** It may navigate, highlight, open, or fill a form. It never commits a change: saving stays a person's click or a backend action with its receipt. Its result says what it showed, never "saved".
- **PAGE-2: availability is not a grant.** A tool registered on the page authorizes nothing on the server.
- **PAGE-3: offered tools are the screen's at submit.** The agent may call only the tools offered with the current request; a name not offered is refused by the bridge.
- **PAGE-4: placement applies.** Floating (PLACE table), the agent calls navigation tools only when the person asked.

### 2.4 Open questions

1. Every registered tool per request, or names only with schemas fetched on first use, when a screen registers many?
2. Should tools of an application page framed from another origin reach the parent chat, and through which channel?
3. When native WebMCP and our bridge both see a tool, can a browser agent and our agent call it concurrently?
