import { describe, it, expect, vi } from 'vitest'
import { getWorkspaceCommands } from '../commands'
import type { NavigateFunction } from 'react-router-dom'

const WS_ID = 'ws-cmd-001'

describe('getWorkspaceCommands', () => {
  it('returns 3 commands', () => {
    const navigate = vi.fn() as unknown as NavigateFunction
    const commands = getWorkspaceCommands(WS_ID, navigate)
    expect(commands).toHaveLength(3)
  })

  it('each command has a unique id', () => {
    const navigate = vi.fn() as unknown as NavigateFunction
    const commands = getWorkspaceCommands(WS_ID, navigate)
    const ids = commands.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('each command run() calls navigate with the correct path', () => {
    const navigate = vi.fn() as unknown as NavigateFunction
    const commands = getWorkspaceCommands(WS_ID, navigate)

    commands[0].run()
    expect(navigate).toHaveBeenCalledWith(`/w/${WS_ID}/settings`)

    commands[1].run()
    expect(navigate).toHaveBeenCalledWith(`/w/${WS_ID}/members`)

    commands[2].run()
    expect(navigate).toHaveBeenCalledWith(`/w/${WS_ID}/invites`)
  })

  it('each command has at least one keyword', () => {
    const navigate = vi.fn() as unknown as NavigateFunction
    const commands = getWorkspaceCommands(WS_ID, navigate)
    for (const cmd of commands) {
      expect(cmd.keywords).toBeDefined()
      expect(cmd.keywords!.length).toBeGreaterThan(0)
    }
  })
})
