# Agent-initiated pane

```mermaid
sequenceDiagram
  participant A as Model / Pi harness
  participant T as exec_ui tool
  participant B as UiBridge
  participant R as UI command route
  participant C as Browser command stream
  participant D as dispatchUiCommand
  participant W as Workspace surface
  participant V as Dockview

  C->>R: GET /api/v1/ui/commands/next
  R->>B: subscribeCommands / drainCommands
  A->>T: openPanel(id, component, params)
  T->>B: postCommand(openPanel)
  B->>B: assign sequence and fan out or queue
  B-->>R: annotated command
  B-->>T: CommandResult
  R-->>C: SSE command event
  C->>D: dispatchUiCommand(openPanel)
  D->>W: open workbench and openPanel
  alt panel already exists
    W->>V: update parameters and activate
  else new panel
    W->>W: require registered panel component
    W->>V: addPanel
  end
```

An agent-created pane has one server dispatch path: `exec_ui` posts a typed command to `UiBridge`, and the browser stream hands it to the shared dispatcher. Dockview focuses an existing panel by ID; for a new panel, the surface first requires its component in the `WorkspaceProvider` registry.

## Depicted files

- `packages/workspace/src/server/ui-control/tools/uiTools.ts`
- `packages/workspace/src/shared/ui-bridge.ts`
- `packages/workspace/src/server/bridge/createInMemoryBridge.ts`
- `packages/workspace/src/server/ui-control/http/uiRoutes.ts`
- `packages/workspace/src/front/bridge/uiCommandStream.ts`
- `packages/workspace/src/front/bridge/uiCommandDispatcher.ts`
- `packages/workspace/src/app/front/WorkspaceAgentFront.tsx`
- `packages/workspace/src/front/provider/WorkspaceProvider.tsx`
- `packages/workspace/src/front/chrome/artifact-surface/SurfaceShell.tsx`
