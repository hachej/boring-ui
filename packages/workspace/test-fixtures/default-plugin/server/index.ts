// Minimal server plugin used by the workspace's defaultPluginPackages
// discovery test. Exercises the full package → boring.server →
// jiti-import → defineServerPlugin → /api/v1/agent/catalog pipeline
// without depending on any external plugin package.
//
// Bare object form (no `(options, ctx) => ...` factory) — sufficient
// because the fixture doesn't need workspaceRoot or bridge injection.
import { defineServerPlugin } from "@hachej/boring-workspace/server"

export default defineServerPlugin({
  id: "boring-fixtures-default-plugin",
  label: "Default Plugin Fixture",
  systemPrompt: "Test fixture. The agent tool `fixture_ping` returns the literal text 'pong'.",
  agentTools: [
    {
      name: "fixture_ping",
      description: "Test fixture agent tool — returns 'pong'.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute() {
        return { content: [{ type: "text", text: "pong" }] }
      },
    },
  ],
})
