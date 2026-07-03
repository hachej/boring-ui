import { describe, expect, it } from 'vitest'
import { preserveServerOwnedUserSettings } from '../routes'

describe('preserveServerOwnedUserSettings', () => {
  it('drops client-supplied __server keys and preserves current server-owned values', () => {
    expect(preserveServerOwnedUserSettings(
      { theme: 'dark', __serverBoringMcpSourcesV1: { forged: true }, __serverNewKey: 'blocked' },
      { locale: 'fr-FR', __serverBoringMcpSourcesV1: { trusted: true } },
    )).toEqual({
      theme: 'dark',
      __serverBoringMcpSourcesV1: { trusted: true },
    })
  })
})
