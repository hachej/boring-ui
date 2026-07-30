import { describe, expect, it } from 'vitest'
import { splitMessageMentions, type MessageMentionCatalog } from '../MessageMentions'

const catalog: MessageMentionCatalog = {
  commands: [{ name: 'reload', clickBehavior: 'execute' }],
  skills: [{ name: 'review-code', commandName: 'skill:review-code' }],
  files: true,
}

function mentions(text: string) {
  return splitMessageMentions(text, catalog).flatMap((segment) => segment.mention ? [segment.mention] : [])
}

describe('splitMessageMentions', () => {
  it.each(['/reload.', 'Try (/reload).', 'Try "/reload"', 'Try “/reload”', 'Try ‘/reload’', '/reload...'])(
    'accepts a complete command token in %s',
    (text) => expect(mentions(text)).toMatchObject([{ kind: 'command', name: 'reload' }]),
  )

  it.each(['/reload/config', '/reload.md', '/reload?unknown', '/reload:unknown', '/reload#unknown', '/reload=unknown', '/reloadé'])(
    'rejects an extended or unknown command token in %s',
    (text) => expect(mentions(text)).toEqual([]),
  )

  it.each([
    ['/reload', { after: 'x' }],
    ['/reload', { before: 'x' }],
    ['!review-code', { after: 'x' }],
    ['!review-code', { before: 'x' }],
    ['@README.md', { after: '.bak' }],
    ['@README.md', { before: 'x' }],
  ])('rejects a %s token made contiguous across a formatting boundary', (text, context) => {
    expect(splitMessageMentions(text, catalog, context).flatMap((segment) => segment.mention ? [segment.mention] : [])).toEqual([])
  })

  it('matches only registered skills', () => {
    expect(mentions('Use !review-code, not !unknown.')).toMatchObject([{
      kind: 'skill',
      name: 'review-code',
      commandName: 'skill:review-code',
    }])
  })

  it.each([
    ['Open @README.md.', 'README.md'],
    ['Open @packages/agent/src/front/index.ts.', 'packages/agent/src/front/index.ts'],
  ])('matches an explicit safe workspace path in %s', (text, path) => {
    expect(mentions(text)).toMatchObject([{ kind: 'file', path }])
  })

  it.each(['@../secret.txt', '@/etc/passwd', '@https://example.test/file.ts', 'person@example.com', '@alice', '@types/node'])(
    'rejects unsafe or ambiguous file text in %s',
    (text) => expect(mentions(text)).toEqual([]),
  )
})
