# MCP setup

The one way every app tells a person how to connect their own assistant (Claude, ChatGPT, Claude Code, others) to it over MCP: a plug icon at the top right of the app's header opens a popover with the app's MCP address, a copy button and short steps per assistant. The block takes the address and the app's name as props and never fetches; the MCP route itself, and its sign-in, stay the app's. The documented way is the shell's prop, `AppShell mcp={{ address, appName, signIn }}` (`shell-mcp` in [app-shell.md](app-shell.md)), so every app shows it the same; an app without AppShell renders `McpSetup` itself.

## Sub-features

- `mcp-setup-trigger` the ghost icon button (`aria-label` and `title` « Connecter un assistant »); Base UI's popover gives click, Enter or Space, focus in and Escape back to the icon. Focus returns to the icon only after a keyboard close, so a click or a tap leaves no focus ring on it. `registry/mcp-setup/mcp-setup.tsx`.
- `mcp-setup-address` the `address` prop shown exactly, selectable, with « Copier » that copies through the kit's `copyText` and says « Copié » for two seconds (or asks to copy by hand when no clipboard route worked). `registry/mcp-setup/mcp-setup.tsx`.
- `mcp-setup-clients` one button per assistant and its steps, one sentence each: `defaultMcpClients(appName, address, locale)` gives Claude (claude.ai and Desktop connectors), ChatGPT (developer-mode connector), Claude Code (a copyable `claude mcp add --transport http` command, marked as for Claude Code only) and « Autre »; `clients` replaces them. `registry/mcp-setup/mcp-setup.tsx`.
- `mcp-setup-words` French by default, `locale="en"` for English, `labels` overrides any word; `signIn` (default on) adds the sentence that the assistant will ask the person to sign in, with no key to copy. `registry/mcp-setup/mcp-setup.tsx`.

## How to get to it (user POV)

In an app whose AppShell has `mcp`, the plug icon is at the top right of the header, just before the screen's actions and the agent's button, at desktop and phone width. A tap opens the popover: the title, what connecting gives, the address with « Copier », the assistants, their steps.

## Driving it with node --test

Preconditions: dependencies installed; fictional app name and address only.

- **Render and drive.** `mcp-setup-trigger`, `mcp-setup-address`, `mcp-setup-clients`, `mcp-setup-words`: `node --test test/ui/mcp-setup.test.mjs` renders the real block with the kit's popover in happy-dom, opens it, checks the address, the assistants and the sign-in sentence, copies the address and the Claude Code command, then English with overridden labels, the app's own steps and `signIn={false}`.

## Gotchas

- The block shows any address it is given: pass the app's real MCP route (`${location.origin}/mcp`), and render the block only where that route answers.
- The popover is capped at the viewport (`100vw - 2rem` wide, `80dvh` tall, scrolls inside), so it stays usable at 390 px without becoming a sheet.
