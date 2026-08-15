# Boring UI Bridge

The bridge lets the agent request UI actions without importing browser code.

## Agent side

Agent tools should use workspace-provided UI bridge tools such as `exec_ui` to open surfaces or panels. Do not write custom polling tab buses.

`exec_ui openFile` controls one focused workbench file slot. Reopening the same path is
idempotent and focuses that slot; opening different paths in succession replaces the
focused file, so only the last remains visible. Always invoke `openFile` when the user
explicitly asks to open, show, display, or navigate to a file, but use it for one file or
the final focus—not to present a set.

For multiple ad-hoc evidence files, put each workspace-relative `@path` in the chat
response as a plain-text mention, not a code span, so the existing inline artifact cards
can open them on demand. If the evidence
belongs to a human decision, register every deliverable in the plural `ask_user`
`artifacts[]` array. These are the existing plural channels; do not invent file tabs,
open-disposition fields, new surface kinds, or URL artifacts.

## Plugin reload

Use `/reload` from chat to reload boring-ui plugin front assets and Pi extensions, tools, skills, and prompts. `boring.server` entries are boot-time/static composition only and require a workspace process restart.

## V2 iframe bridge

Future remote plugin UI runs in an iframe and communicates with the host through postMessage:

```
iframe -> boring.bridge.ready
host   -> boring.bridge.init { theme, pluginId, panelId, params }
iframe -> boring.bridge.rendered
```

For V1 local plugins, no iframe bridge is needed.
