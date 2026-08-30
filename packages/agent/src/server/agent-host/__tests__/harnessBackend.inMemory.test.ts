import { harnessBackendConformance } from '../testing/harnessBackendConformance'
import { InMemoryHarnessBackend } from '../testing/inMemoryHarnessBackend'

harnessBackendConformance({
  name: 'in-memory',
  replayGapCase: true,
  createBackend: () => {
    const backend = new InMemoryHarnessBackend(5, true)
    return {
      backend,
      injectActionFailure(action, error) {
        if (action === 'submitPrompt') backend.nextPromptError = error
        else backend.nextFollowUpError = error
      },
    }
  },
})
