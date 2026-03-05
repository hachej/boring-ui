# References

External references, API docs, and third-party documentation relevant to boring-ui.

## Core Dependencies

| Dependency | Purpose | Docs |
|---|---|---|
| React 18 | UI framework | https://react.dev |
| DockView | Panel layout system | https://dockview.dev |
| TipTap | Rich text editor | https://tiptap.dev |
| xterm.js | Terminal emulator | https://xtermjs.org |
| Zustand | State management | https://zustand-demo.pmnd.rs |
| TailwindCSS 4 | Utility CSS | https://tailwindcss.com |
| FastAPI | Python web framework | https://fastapi.tiangolo.com |
| Vite | Frontend build tool | https://vitejs.dev |
| Playwright | E2E testing | https://playwright.dev |
| Vitest | Unit testing | https://vitest.dev |

## AI/Agent Dependencies

| Dependency | Purpose |
|---|---|
| `@mariozechner/pi-agent-core` | PI agent core logic |
| `@mariozechner/pi-ai` | PI AI integration |
| `@mariozechner/pi-web-ui` | PI web UI components |
| `@assistant-ui/react` | Assistant UI primitives |
| `@assistant-ui/react-markdown` | Markdown rendering for assistant UI |

## Guides

| Guide | Description |
|---|---|
| [Extension Guide](EXTENSION_GUIDE.md) | Extending boring-ui with custom panels, routers, and configuration |
| [Ownership Audit](OWNERSHIP_AUDIT.md) | Final keep-vs-move audit and sandbox cleanup checklist for service ownership split |
| [Modes and Profiles](../runbooks/MODES_AND_PROFILES.md) | Canonical `core`/`edge` deployment contract and UI runtime profile matrix |

## Related Projects

| Project | Relationship |
|---|---|
| boring-sandbox | Optional edge proxy/orchestration (routing/provisioning/token injection) |
| boring-coding | Shared workflow docs, agent conventions, tooling |
