# Boring UI Bridge

The bridge lets the agent request UI actions without importing browser code.

## Agent side

Agent tools should use workspace-provided UI bridge tools such as `exec_ui` to open surfaces or panels. Do not write custom polling tab buses.

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
