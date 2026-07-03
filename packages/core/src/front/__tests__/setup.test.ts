import { describe, expect, it } from 'vitest'
import { withTaskId } from '../../server/__tests__/_setup'
import { useMswHandler } from './_setup'

describe('front test setup', () => {
  it(
    'supports fetch mocking via handler registry',
    withTaskId('boring-ui-v2-eyll', async ({ assertionPassed }) => {
      useMswHandler(async (input) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (!url.endsWith('/api/v1/config')) return undefined
        return new Response(
          JSON.stringify({ appId: 'test', appName: 'Boring Test' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
      })

      const response = await fetch('http://localhost/api/v1/config')
      const payload = (await response.json()) as {
        appId: string
        appName: string
      }

      assertionPassed('front-fetch-mock')
      expect(payload).toEqual({
        appId: 'test',
        appName: 'Boring Test',
      })
    }),
  )
})
