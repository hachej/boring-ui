import boringAutomationPlugin from '@hachej/boring-automation/front'

/** Canonical hosted agent owner used by full-app sessions and automation runs. */
export const FULL_APP_AGENT_TYPE_ID = 'default'

/** Keep aligned with FULL_APP_DEFAULT_PLUGIN_PACKAGE_DESCRIPTORS. */
export const FULL_APP_FRONT_PLUGINS = [boringAutomationPlugin]

export const FULL_APP_AGENT_COMPOSITION = {
  agentTypeId: FULL_APP_AGENT_TYPE_ID,
  plugins: FULL_APP_FRONT_PLUGINS,
}
