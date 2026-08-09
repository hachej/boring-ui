# Package map

```mermaid
flowchart TB
  subgraph hosts[Apps and runnable hosts]
    apps[full-app and playgrounds]
    cli[boring-ui CLI]
  end

  subgraph composition[Composition packages]
    core[boring-core<br/>identity · persistence · app shell]
    workspace[boring-workspace<br/>workbench · plugins · UI bridge]
    agent[boring-agent<br/>gateway · sessions · harness]
  end

  subgraph runtime[Execution packages]
    bash[boring-bash<br/>environment operations · Pi tools]
    sandbox[boring-sandbox<br/>isolation providers]
  end

  subgraph extensions[Extensions and authoring]
    plugins[plugins/*<br/>front + trusted server contributions]
    pluginCli[boring-ui-plugin CLI]
    pi[boring-pi<br/>Markdown skills + references only]
  end

  ui[boring-ui-kit<br/>shared UI primitives]

  apps --> core
  apps --> workspace
  apps --> agent
  cli --> workspace
  cli --> agent
  cli --> bash
  cli --> sandbox
  cli --> ui
  cli --> plugins
  cli --> pluginCli

  core --> workspace
  core --> agent
  core --> bash
  workspace -->|app surfaces| agent
  workspace --> bash
  workspace --> sandbox
  workspace --> pluginCli
  agent --> bash
  agent --> sandbox

  plugins --> workspace
  plugins --> ui
  plugins -. trusted feature seams .-> agent
  plugins -. trusted feature seams .-> core
  pluginCli -. scaffolds and resolves .-> plugins
  pi -. resolved Markdown resources .-> workspace

  core --> ui
  workspace --> ui
  agent --> ui
  bash -. peer type surface .-> agent
  sandbox -. peer type surface .-> agent
```

Solid arrows show current host composition or declared package consumption;
dashed arrows are optional, tooling, knowledge, or peer-type edges.
`boring-pi` contains no runtime code.

## Depicted files

- `pnpm-workspace.yaml`
- `packages/core/package.json`
- `packages/agent/package.json`
- `packages/workspace/package.json`
- `packages/cli/package.json`
- `packages/ui/package.json`
- `packages/pi/package.json`
- `packages/plugin-cli/package.json`
- `packages/boring-bash/package.json`
- `packages/boring-sandbox/package.json`
- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`
- `packages/cli/src/server/modeApps.ts`
- `packages/cli/src/front/App.tsx`
- `apps/full-app/src/server/main.ts`
- `plugins/ask-user/src/server/index.ts`
- `plugins/boring-automation/src/front/AutomationCard.tsx`
- `plugins/boring-governance/src/server/index.ts`
