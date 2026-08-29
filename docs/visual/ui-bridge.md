# UiBridge dispatch

```mermaid
flowchart LR
  subgraph server[Server and shared]
    producers[Agent and server producers<br/>exec_ui · plugin helpers · HTTP POST]
    seam[UiBridge.postCommand<br/>canonical server dispatch seam]
    bridge[In-memory bridge<br/>sequence · queue · fan-out]
    routes[UI command route<br/>SSE or polling]
    producers --> seam --> bridge --> routes
  end

  subgraph front[Browser front]
    stream[startUiCommandStream]
    local[Browser-local UI actions]
    bus[uiCommandBus]
    dispatch[dispatchUiCommand]
    surface[Workspace surface<br/>files · panels · notifications]
    routes --> stream --> dispatch --> surface
    local --> bus --> dispatch
  end

  subgraph chat[Chat presentation only]
    part[PiChatEvent ui-command<br/>displayOnly: true]
    reducer[piChatReducer<br/>state unchanged]
    part -->|display-only; ignored| reducer
  end
```

Agent and server producers converge on `UiBridge.postCommand`; the bridge transport and browser-local bus share the final dispatcher. Pi chat `ui-command` events are display-only, so the chat reducer leaves state unchanged and never redispatches them.

## Depicted files

- `docs/procedures/coding-invariants.md`
- `packages/workspace/src/shared/ui-bridge.ts`
- `packages/workspace/src/shared/plugins/uiBridgeRegistry.ts`
- `packages/workspace/src/server/bridge/createInMemoryBridge.ts`
- `packages/workspace/src/server/ui-control/http/uiRoutes.ts`
- `packages/workspace/src/server/ui-control/tools/uiTools.ts`
- `packages/workspace/src/front/bridge/uiCommandStream.ts`
- `packages/workspace/src/front/bridge/uiCommandBus.ts`
- `packages/workspace/src/front/bridge/uiCommandDispatcher.ts`
- `packages/agent/src/server/pi-chat/piChatEvents.ts`
- `packages/agent/src/front/chat/pi/piChatReducer.ts`
