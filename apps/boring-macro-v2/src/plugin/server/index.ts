/**
 * Macro Server Plugin
 * 
 * Provides agent tools for macro-economic data analysis.
 */

import type { AgentTool } from '@boring/agent/shared'
import type { MacroConfig } from '../../server/config'
import { createMacroTools } from '../../server/tools/macroTools'
import { MACRO_OPEN_SERIES_SURFACE_KIND } from '../constants'

export function makeMacroServerPlugin(macroConfig: MacroConfig): {
  id: string
  label: string
  agentTools: AgentTool[]
  systemPrompt: string
} {
  const tools = createMacroTools(macroConfig.clickhouse)

  return {
    id: 'boring-macro',
    label: 'Macro',
    agentTools: tools,
    systemPrompt: `
## Macro Plugin Capabilities

You have access to macro-economic timeseries tools and data.

### Available Tools

- execute_sql(query) - Run read-only SQL on ClickHouse (87k+ FRED series)
- macro_search(query, limit) - Search series catalog
- get_series_data(series_id, from, to, limit) - Fetch observations
- persist_derived_series(output_id, title, input_ids, observations) - Save derived data

### Best Practices

1. Search for series before using them
2. Use read-only SQL (SELECT, WITH, EXPLAIN only)
3. Always persist derived series with meaningful IDs
	4. To show a series chart, call exec_ui with kind "openSurface" and params
	   { kind: "${MACRO_OPEN_SERIES_SURFACE_KIND}", target: series_id, meta: { title } }
	`.trim(),
  }
}
