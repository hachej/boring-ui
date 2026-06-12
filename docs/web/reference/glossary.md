# Glossary

## App shell
The final application that composes the publishable packages into a user-facing product.

## Core
Shorthand for `@hachej/boring-core`, the package that owns persistence, identity, config, and the app foundation.

## Agent
Shorthand for `@hachej/boring-agent`, the package that owns the coding-agent runtime, tools, chat transport, and standalone app shape.

## Workspace
Shorthand for `@hachej/boring-workspace`, the package that owns workspace layouts, plugin contracts, and the UI bridge.

## Harness
The runtime abstraction that runs the LLM conversation loop and streams agent output.

## Catalog
The tool catalog visible to the LLM. It binds concrete tools against workspace and sandbox capabilities.

## Workspace adapter
The path-scoped filesystem abstraction used by both HTTP routes and agent tools.

## Sandbox
The execution abstraction for shell commands and optional isolated-code execution.

## Runtime mode
A named pairing of workspace adapter plus sandbox adapter, such as `direct`, `local`, or `vercel-sandbox`.

## UI bridge
The command/state bridge between backend intent and frontend workspace behavior. `UiBridge.postCommand` is the single dispatch source.

## Plugin output
A typed contribution from a workspace plugin, such as a panel, command, catalog, or surface resolver.

## Surface resolver
A plugin output that maps domain-level open requests into concrete panel openings.

## Capabilities
The aggregated feature description exposed by core and extended by contributors.

## Diátaxis
A documentation framework that separates tutorial, how-to, reference, and explanation content.
