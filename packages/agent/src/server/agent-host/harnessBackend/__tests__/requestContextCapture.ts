import { vi } from 'vitest'
import type { PiSessionRequestContext } from '../../../../core/piChatSessionService'
import { HarnessPiChatService } from '../../../pi-chat/harnessPiChatService'

export async function captureReadStateRequestContexts(
  run: () => Promise<void>,
): Promise<PiSessionRequestContext[]> {
  const observed: PiSessionRequestContext[] = []
  const original = HarnessPiChatService.prototype.readState
  const spy = vi.spyOn(HarnessPiChatService.prototype, 'readState').mockImplementation(async function (
    this: HarnessPiChatService,
    ctx,
    sessionId,
  ) {
    observed.push({ ...ctx })
    return await original.call(this, ctx, sessionId)
  })
  try {
    await run()
    return observed
  } finally {
    spy.mockRestore()
  }
}
