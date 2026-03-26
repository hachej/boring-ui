import { describe, expect, it } from 'vitest'
import {
  getPanelComponent,
  countAgentPanels,
  listDockPanels,
  isCenterContentPanel,
} from '../../utils/dockHelpers'

const makePanel = (id, component) => ({
  id,
  api: { component },
  component,
})

const makeApi = (panels) => ({
  panels,
  getPanel: (id) => panels.find((p) => p.id === id),
})

describe('getPanelComponent', () => {
  it('returns api.component when present', () => {
    expect(getPanelComponent({ api: { component: 'agent' } })).toBe('agent')
  })

  it('falls back to panel.component', () => {
    expect(getPanelComponent({ component: 'terminal' })).toBe('terminal')
  })

  it('returns empty string for missing panel', () => {
    expect(getPanelComponent(null)).toBe('')
    expect(getPanelComponent(undefined)).toBe('')
    expect(getPanelComponent({})).toBe('')
  })
})

describe('countAgentPanels', () => {
  it('counts agent panels', () => {
    const api = makeApi([
      makePanel('agent', 'agent'),
      makePanel('agent-chat-1', 'agent'),
      makePanel('editor-foo', 'editor'),
    ])
    expect(countAgentPanels(api, 'agent')).toBe(2)
  })

  it('counts terminal panels', () => {
    const api = makeApi([
      makePanel('terminal', 'terminal'),
      makePanel('terminal-chat-1', 'terminal'),
      makePanel('agent', 'agent'),
    ])
    expect(countAgentPanels(api, 'terminal')).toBe(2)
  })

  it('returns 0 when no matching panels exist', () => {
    const api = makeApi([makePanel('editor-foo', 'editor')])
    expect(countAgentPanels(api, 'agent')).toBe(0)
  })

  it('returns 0 for empty panel list', () => {
    expect(countAgentPanels(makeApi([]), 'agent')).toBe(0)
    expect(countAgentPanels(null, 'agent')).toBe(0)
  })
})

describe('listDockPanels', () => {
  it('returns api.panels when it is an array', () => {
    const panels = [makePanel('a', 'agent')]
    expect(listDockPanels({ panels })).toBe(panels)
  })

  it('calls getPanels when panels is not an array', () => {
    const panels = [makePanel('a', 'agent')]
    expect(listDockPanels({ getPanels: () => panels })).toBe(panels)
  })

  it('returns empty array for null api', () => {
    expect(listDockPanels(null)).toEqual([])
  })
})

describe('sidebar width restoration after last agent panel close', () => {
  // This tests the logic pattern used in App.jsx onDidRemovePanel:
  // when the removed panel is an agent and no other agent panels remain,
  // the left sidebar should be restored to its saved width.

  it('detects when the last agent panel is being removed', () => {
    const agentPanel = makePanel('agent', 'agent')
    const editorPanel = makePanel('editor-foo', 'editor')
    const allPanels = [agentPanel, editorPanel]

    // Simulate: agentPanel was just removed (excluded from remaining check)
    const removedPanel = agentPanel
    const hasRemainingAgents = allPanels
      .filter((p) => p.id !== removedPanel.id)
      .some((p) => getPanelComponent(p) === 'agent')

    expect(getPanelComponent(removedPanel)).toBe('agent')
    expect(hasRemainingAgents).toBe(false)
  })

  it('does not trigger when other agent panels remain', () => {
    const agent1 = makePanel('agent', 'agent')
    const agent2 = makePanel('agent-chat-1', 'agent')
    const allPanels = [agent1, agent2]

    const removedPanel = agent1
    const hasRemainingAgents = allPanels
      .filter((p) => p.id !== removedPanel.id)
      .some((p) => getPanelComponent(p) === 'agent')

    expect(hasRemainingAgents).toBe(true)
  })

  it('does not trigger when a non-agent panel is removed', () => {
    const agent = makePanel('agent', 'agent')
    const editor = makePanel('editor-foo', 'editor')

    const removedPanel = editor
    expect(getPanelComponent(removedPanel)).not.toBe('agent')
  })
})
