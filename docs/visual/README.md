# Visual architecture

Diagram-first orientation to the current system. Package docs, contracts, and
accepted decisions remain normative.

| View | Shows |
| --- | --- |
| [Package map](package-map.md) | Apps, packages, plugins, tooling, and knowledge boundaries |
| [Runtime stack](runtime-stack.md) | Agent orchestration over boring-bash operations and boring-sandbox providers |
| [AgentGateway](agent-gateway.md) | Authorized, addressed session operations and their construction funnel |
| [UiBridge](ui-bridge.md) | Agent-to-browser command dispatch and the display-only chat lane |
| [Chat turn](chat-turn.md) | Prompt admission, Pi execution, event fan-out, and browser reduction |
| [Agent-initiated pane](agent-initiated-pane.md) | An `openPanel` tool call reaching Dockview through the bridge |

Further connector and request-flow diagrams are tracked in
[epic #1177](https://github.com/hachej/boring-ui/issues/1177).
