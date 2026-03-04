import { describe, expect, it } from 'vitest'
import { getAdditionalChatPanelTools } from './chatPanelTools'

describe('getAdditionalChatPanelTools', () => {
  it('removes artifacts tool and preserves order', () => {
    const tools = [
      { name: 'read_file' },
      { name: 'artifacts' },
      { name: 'write_file' },
      { name: 'python_exec' },
    ]

    const result = getAdditionalChatPanelTools({ state: { tools } })
    expect(result.map((tool) => tool.name)).toEqual(['read_file', 'write_file', 'python_exec'])
  })

  it('handles missing state/tools safely', () => {
    expect(getAdditionalChatPanelTools(null)).toEqual([])
    expect(getAdditionalChatPanelTools({ state: {} })).toEqual([])
  })
})
