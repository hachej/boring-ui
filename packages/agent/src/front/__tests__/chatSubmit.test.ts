import { describe, expect, it } from 'vitest'
import { createEnrichedSubmitPayload } from '../chatSubmit'

describe('createEnrichedSubmitPayload', () => {
  it('includes uploaded workspace paths for binary attachments', async () => {
    const result = await createEnrichedSubmitPayload({
      text: 'can you read this?',
      mentionedFiles: [],
      files: [{
        type: 'file',
        filename: 'Screenshot.png',
        mediaType: 'image/png',
        url: '../assets/images/screenshot-abc.png',
        path: 'assets/images/screenshot-abc.png',
      } as never],
    })

    expect(result.serverMessage).toContain('can you read this?')
    expect(result.serverMessage).toContain('<attachment data-boring-agent="composer-file"')
    expect(result.serverMessage).toContain('filename="Screenshot.png"')
    expect(result.serverMessage).toContain('path="assets/images/screenshot-abc.png"')
    expect(result.serverMessage).toContain('binary="true"')
    expect(result.attachments).toEqual([
      expect.objectContaining({
        filename: 'Screenshot.png',
        mediaType: 'image/png',
        url: '../assets/images/screenshot-abc.png',
        path: 'assets/images/screenshot-abc.png',
      }),
    ])
  })
})
