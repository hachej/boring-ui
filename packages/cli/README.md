# @hachej/boring-ui

**Turn an agent into an app.**

Start a full agent workspace pointed at your current directory — chat, panels, file tree, command palette — in one command.

```bash
npx @hachej/boring-ui
```

No config. No clone. No database. Requires an Anthropic API key (or login via Claude/Copilot/Gemini on first run).

---

## What it starts

- A chat interface wired to a real coding agent
- A workspace with panels, a file tree, and a command palette
- The agent runs with full access to your current directory

## API key

Set it in your environment:

```bash
ANTHROPIC_API_KEY=sk-ant-... npx @hachej/boring-ui
```

Or run without it — the first launch will open a login prompt to authenticate via Claude, Copilot, Gemini, or Codex. Credentials are stored and reused on future runs.

## Options

```bash
PORT=8080 npx @hachej/boring-ui          # custom port (default: 5200)
BORING_AGENT_WORKSPACE_ROOT=/my/project npx @hachej/boring-ui  # custom root
```

---

## Building something bigger?

`@hachej/boring-ui` is the zero-config entry point. For a full app with auth, workspaces, and a database, see the [boring-ui monorepo](https://github.com/hachej/boring-ui).
