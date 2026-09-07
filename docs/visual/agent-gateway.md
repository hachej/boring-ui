# AgentGateway session flow

```mermaid
flowchart LR
  subgraph authority[App-owned authority]
    request[Addressed HTTP request]
    scope[AuthorizedAgentScope<br/>issuer-owned capability]
    claim[AgentScopeVerifier.verify<br/>VerifiedAgentScopeClaim]
    request --> scope
  end

  subgraph contract[Shared contract]
    gateway[AgentGateway<br/>7 scoped operations<br/>listAgents · listSessions<br/>create · connect · read · rename · delete]
    close[AgentGateway.close<br/>lifecycle only · no scope]
  end

  subgraph server[Agent server]
    embedded[EmbeddedAgentGateway<br/>re-check · ledger · session pin]
    inventory[Fleet and inventory reads<br/>listAgents · listSessions]
    binding[Session runtime binding<br/>create · connect · read · rename · delete]
    service[PiChatSessionService<br/>session store + Pi harness]
    shutdown[Close active gateway connections]
    binding --> service
    close --> shutdown
  end

  funnel[createAgentHost<br/>only construction funnel]

  scope -->|nested scope on every operation| gateway
  gateway --> embedded
  embedded -->|verify every use| claim
  claim --> inventory
  claim -->|session-bearing operation| binding
  funnel -. constructs .-> embedded
  funnel -. wires HTTP projection .-> request
  funnel -. builds compositions .-> binding
```

The seven addressed operations carry branded scope and re-verify it; fleet and inventory reads stay on host state, while session-bearing calls resolve an Agent runtime binding and Pi service. `AgentGateway.close()` is lifecycle-only, and `createAgentHost()` is the sole construction funnel for the embedded gateway, addressed routes, and Agent-owned composition.

## Depicted files

- `packages/agent/docs/AGENT_GATEWAY_V0.md`
- `packages/agent/src/shared/gateway/types.ts`
- `packages/agent/src/server/agent-host/createAgentHost.ts`
- `packages/agent/src/server/agent-host/embeddedGateway.ts`
- `packages/agent/src/server/agent-host/httpProjection.ts`
- `packages/agent/src/server/agent-host/buildAgentComposition.ts`
- `packages/agent/src/core/piChatSessionService.ts`
