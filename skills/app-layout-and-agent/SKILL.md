---
name: app-layout-and-agent
description: Lay out a Boring UI app and place its agent. Use for AppShell (layouts screen, workspace, chat), nav items, ListDetail, screen headers, the phone tab bar or sheet, the collapsed left pane, where the agent lives (shell layer, full page, embedded screen, ambient bar, placed), and for customising the chat from the app side (AgentSpec, chatProps, labels, conversations, mentions beyond files, tool cards, natural presentation). Pick this before writing any layout code or any PiChat prop.
---

# Lay out the app, place the agent

The app shell is a registry block (`app-shell`), installed with `boring-ui-blocks` (skill `add-blocks`) and never edited. The app shapes it through the props below. The feature map of what exists is [features/README.md](../../features/README.md); the full prop reference is [registry/README.md](../../registry/README.md#agent-layer-app-shell).

## Pick the layout

`AppShell` takes `layout` ([registry/app-shell/app-shell.tsx](../../registry/app-shell/app-shell.tsx)):

| `layout` | The screens are | Left pane starts | Pick it when |
| --- | --- | --- | --- |
| `screen` | one page per nav item | open (wide sidebar) | a few independent screens |
| `workspace` | a `ListDetail` (list pane, detail pane) | collapsed to the icon rail | records to browse and open: the default for a data app |
| `chat` | the one nav item renders `AgentWorkspace` | icon rail | the page is the conversation (no `agent` prop: the shell throws) |

- Phone: a bottom tab bar (four items; more give three plus « Plus »). `compactNav="sheet"` drops the bar and opens the sidebar as a sheet from the header. Wide: the shadcn sidebar; `rail="hover"` keeps it at icon width and reveals labels on hover.
- A nav item is `NavItem { id, label, icon, render, badge?, sidebar? }` ([nav.tsx](../../registry/app-shell/nav.tsx)). The app's router owns the URL: pass `route={{ id, onChange }}`. Every screen stays mounted, so keep state out of unmount.
- One header per screen: call `useScreenHeader({ title, subtitle?, back?, actions?, leading?, dense? })` inside the screen ([header.tsx](../../registry/app-shell/header.tsx)).
- `ListDetail { list, detail, onBack, collapsible?, collapsed?, railWidth?, title? }` ([list-detail.tsx](../../registry/app-shell/list-detail.tsx)): both panes wide; one at a time on a phone, the detail pushed as one history entry. Keep selection in the URL so a deep link opens the detail.
- `account={{ name, email?, menu, signOut?, theme? }}` ([account.tsx](../../registry/app-shell/account.tsx)); `theme: { value, onChange }` adds the dark-mode switch. `locale` (`fr` | `en`) sets the shell's own words.
- Tell the agent what is on show with `useAgentContext({ name, params })` ([agent-context.ts](../../registry/app-shell/agent-context.ts)); it travels with each message as `context`.

## Place the agent

| Placement | Component | Pick it when |
| --- | --- | --- |
| Shell layer (default) | `AppShell agent={spec}` | the app has screens and the agent helps from any of them. Phone: bottom drawer (peek, half, full); wide: a right panel, floatable and dockable |
| Full page | `AppShell layout="chat"` + `AgentWorkspace` (item `pi-app`) | the agent is the product |
| Embedded screen | `AgentWorkspace layout="embedded"` in a nav item | one screen is a conversation with files and a Library; its bar controls go into the screen header |
| Placed | `PlacedAgentWorkspace` (item `placed-agent`) | the same conversation lives in a tab and collapses beside the app |
| Ambient bar | `AmbientChat` (item `pi-ambient`) | an existing website or console, no shell: a floating bar over it |
| Bare chat | `PiChat` (item `pi-chat`) | you lay the page out yourself |

`AppShell improve={spec}` adds a second agent (« Améliorer l'app ») to the account menu; omit it unless the host has such an agent. A launch link opens the layer: `agentLink({ agent, open, input })` builds it, `AppShell agentLink={false}` turns reading it off.

## Customise the agent from the app

`AgentSpec { controller, label?, icon?, chatProps?, voice?, feedback?, headerActions? }` ([agent-layer.tsx](../../registry/app-shell/agent-layer.tsx)). The controller comes from `useRemoteChat({ conversationId, identity, endpoint, fetch })` ([use-remote-chat.ts](../../registry/pi-chat/use-remote-chat.ts)); the agent's server side is skill `build-agent-app`. Everything else is `chatProps`, the props of `PiChat` ([pi-chat.tsx](../../registry/pi-chat/pi-chat.tsx)):

- Words and look: `locale`, `labels`, `icons`, `avatar`, `headerActions`, `emptyState`, `suggestions`, `messageStyle`. Every visual value is a theme token; a block never takes a literal.
- Threads: `conversations: useConversations({ endpoint, fetch, activeId, onSelect })` shows History with New, rename, archive, fork.
- People who read a conversation, not a trace: `presentation="natural"` hides tool steps and reasoning.
- Tool results your way: `toolRenderers` (by tool name), `renderTool`, `cards={{ question, approval, subagent }}`, `artifacts`. Wire all plug-ins at once with `withChatPlugins(props)`.
- Composer features exist only when their prop and item are present: `slash`, `mentions`, `attachments`, `model`, `effort`, `voiceMessage`. Prop table: [registry/README.md](../../registry/README.md#blocks-what-to-install).

### Mentions of things that are not files

`MentionsConfig` ([config.ts](../../registry/pi-chat/config.ts)) is generic: `search(query, signal)` returns `{ path, kind?, label? }`, and `path` can be any stable id token (`meal-12`, a member id). Install `pi-chat-mentions`, then give:

- `Picker: MentionPicker`, `listLabel` and `icon` for the menu, `renderOption(item, query)` for each row;
- `label(id)` for the chip, `renderSent(id)` for the sent message (`render` is the older hook);
- `generation` to make an open picker search again when the catalog changes.

The message carries the token as text (`@id`). `createMentionResolver` (`@hachej/boring-agent/mentions`) expands workspace files only; the host resolves any other id itself, in an agent tool that looks it up or a Pi extension. Model the client side on `useSharedChat` ([registry/shared-chat/use-shared-chat.tsx](../../registry/shared-chat/use-shared-chat.tsx)), which does it for members.

## Rules

1. Install and update blocks with `boring-ui-blocks` only; configure through props and tokens.
2. One controller per conversation; a placement change moves the controller, never copies the chat.
3. Phone first: the layer, tab bar and sheets already follow the keyboard and the safe areas; do not add your own fixed bars.
4. Prove a layout with the shell journeys: `npm run app-shell:journey`, `app-shell:journey:workspace`, `app-shell:journey:placed` (examples in [examples/app-shell](../../examples/app-shell)).
