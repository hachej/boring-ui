// Minimal front plugin used by the workspace's defaultPluginPackages
// discovery test. Exercises the full package → boring.front →
// frontUrl → /api/v1/agent-plugins pipeline without depending on any
// external plugin package.
import { definePlugin } from "@hachej/boring-workspace/plugin"

export default definePlugin({
  id: "boring-fixtures-default-plugin",
  label: "Default Plugin Fixture",
  panels: [
    {
      id: "default-plugin-fixture.panel",
      label: "Default Plugin Fixture",
      component: () => null,
    },
  ],
})
