# Product Specifications

Index of product specs for boring-ui features.

## Current Features

| Feature | Spec | Status |
|---|---|---|
| File Tree | (inline below) | Shipped |
| Code Editor | (inline below) | Shipped |
| Claude Chat Sessions | (inline below) | Shipped |
| Shell Terminal | (inline below) | Shipped |
| Tool Approval | (inline below) | Shipped |
| Companion Chat | (inline below) | Shipped |
| PI Chat | (inline below) | Shipped |
| Deployment Modes + UI Profiles | `docs/runbooks/MODES_AND_PROFILES.md` | Shipped |
| User Menu | `docs/exec-plans/backlog/SIDEBAR_USER_MENU_PLAN.md` | In progress |
| Service Split | `docs/exec-plans/completed/bd-3g1g/` | Completed |

## Feature Summaries

### File Tree
Browse the workspace filesystem. Shows directory tree with expand/collapse, file icons by extension, git status indicators (modified, untracked, staged). Click to open files in the editor. Requires `files` backend feature.

### Code Editor
TipTap-based editor for markdown and code files. Supports frontmatter editing, syntax highlighting (via lowlight), image embedding, and tables. Opens files from the file tree. Requires `files` backend feature.

### Claude Chat Sessions
Interactive Claude AI chat via WebSocket streaming. Supports multiple sessions, message history, tool use with approval workflow. Rendered in the Terminal panel. Requires `chat_claude_code` backend feature.

### Shell Terminal
xterm.js terminal connected to a PTY process via WebSocket. Supports multiple shell providers (bash, claude CLI). Requires `pty` backend feature.

### Tool Approval
When Claude wants to use a tool (file write, command execution), the approval panel shows the request and lets the user approve or deny. In-memory approval store. Requires `approval` backend feature.

### Companion Chat
Chat interface for the Companion agent. Uses a provider registry pattern. Can run in embedded mode (built-in UI) or delegate to an external service URL. Always available (no backend URL required for embedded mode).

### PI Chat
Chat interface for the PI agent. Supports embedded mode (built-in chat UI using `@mariozechner/pi-web-ui`) or iframe mode (loads external PI_URL). Available in embedded mode without configuration; iframe mode requires `PI_URL` env var.

## Adding a Spec

For larger features, create a dedicated spec file in this directory:
```
docs/product-specs/<feature-name>.md
```
