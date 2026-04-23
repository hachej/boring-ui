import type { CommandResult, UiBridge, UiCommand, UiState } from '../../shared/ui-bridge'

type CommandSubscriber = (cmd: UiCommand & { seq: number }) => void

export interface MockUiBridge extends UiBridge {
  readonly commands: Array<UiCommand & { seq: number }>
  queueResult(result: Omit<CommandResult, 'seq'>): void
}

export function mockUiBridge(initialState: UiState | null = null): MockUiBridge {
  const commands: Array<UiCommand & { seq: number }> = []
  const resultQueue: Array<Omit<CommandResult, 'seq'>> = []
  const subscribers = new Set<CommandSubscriber>()
  let state = initialState
  let seq = 1

  return {
    commands,
    queueResult(result) {
      resultQueue.push(result)
    },
    async getState() {
      return state
    },
    async setState(nextState) {
      state = nextState
    },
    async postCommand(cmd) {
      const nextSeq = seq++
      const queuedCommand = { ...cmd, seq: nextSeq }
      commands.push(queuedCommand)
      for (const subscriber of subscribers) {
        subscriber(queuedCommand)
      }

      const nextResult = resultQueue.shift()
      if (nextResult) {
        return { ...nextResult, seq: nextSeq }
      }
      return { seq: nextSeq, status: 'ok' }
    },
    subscribeCommands(handler) {
      subscribers.add(handler)
      return () => {
        subscribers.delete(handler)
      }
    },
  }
}
