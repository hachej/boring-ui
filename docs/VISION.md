# Pluggable-Agent Platform Vision

This document describes the strategic target architecture for the pluggable-agent platform. Subsystem implementations are contributed incrementally by individual issues.

## 1. The North Star

The destination is a declarative, highly-efficient agent platform integrated with the **boring-ui workspace** and hosted in Europe:

* **Eve-Style Declarative Authoring**: Developers scaffold a self-contained `agents/<name>/` directory that compiles to a content-addressed, immutable bundle containing a versioned `AgentDefinition` and referenced assets. There are no platform-source edits or imperative wiring to deploy a new agent.
* **Workspace-First Composition**: The workspace acts as the control plane for authorized agents. It handles session management, task execution, artifact publication (`data-artifact`), and human-in-the-loop approvals (`resolveInput`).
* **Open MCP Integration**: Foreign agents (e.g., Claude Code, external MCP clients) can seamlessly attach, project environments, create tasks, and deliver structured artifacts through the platform's MCP control plane.
* **EU-Sovereign Sandboxing**: Multi-tenant execution is secured using isolated, highly-performant sandbox environments (such as gVisor) on EU-based infrastructure.

## 2. Platform Architecture Horizons

The architecture is designed to scale across three commercial horizons without requiring code forks:

1. **Horizon 1 (Sovereign Managed/Self-Host)**: Named vertical analyst agents share a production deployment while remaining isolated by authorized workspace/default-agent bindings.
2. **Horizon 2 (AI Analyst Workroom)**: A white-label workspace environment for consultancies to collaborate with custom agents.
3. **Horizon 3 (Hub-and-Spoke)**: A free local CLI delegating specialized tasks to hosted agents via MCP, delivering artifacts cross-organization.

## 3. Contribution Model

Individual issues contribute to this vision by implementing specific, reviewable slices of the platform. Each slice is responsible for updating the actual-state documentation in the relevant packages:

* **Core Agent Runtime** $\rightarrow$ `packages/agent/README.md`
* **Workspace Protocol & Bridge** $\rightarrow$ `docs/WORKSPACE_CONTRACT.md`
* **Sandbox & Environment Providers** $\rightarrow$ `packages/boring-sandbox/README.md`
