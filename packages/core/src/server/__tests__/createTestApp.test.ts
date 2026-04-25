import { describe, expect, it } from 'vitest'
import { withBeadId } from './_setup'
import { createTestApp } from './createTestApp'

describe('createTestApp', () => {
  it(
    'captures outgoing emails in mailbox',
    withBeadId('boring-ui-v2-eyll', async ({ assertionPassed }) => {
      const harness = await createTestApp()

      await harness.sendMail({
        to: 'user@test.dev',
        subject: 'Hello',
        html: '<p>Hello</p>',
        text: 'Hello',
      })

      assertionPassed('mailbox-capture')
      expect(harness.store).toBe('local')
      expect(harness.mailbox.messages).toHaveLength(1)
      expect(harness.mailbox.messages[0]?.subject).toBe('Hello')
    }),
  )
})
