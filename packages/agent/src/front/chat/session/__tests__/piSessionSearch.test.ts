import { describe, expect, it } from 'vitest'
import {
  parsePiSessionSearchQuery,
  searchPiSessions,
} from '../piSessionSearch'

const sessions = [
  {
    id: 'session-a',
    title: 'Alpha architecture plan',
    allMessagesText: 'discussed workspace left pane and skills overlay',
    cwd: '/repo/boring-ui',
    updatedAt: '2026-06-21T10:00:00Z',
  },
  {
    id: 'session-b',
    title: 'Beta build polish',
    allMessagesText: 'fixed command palette and catalog search',
    cwd: '/repo/boring-ui',
    updatedAt: '2026-06-21T11:00:00Z',
  },
  {
    id: 'session-c',
    title: 'Release checklist',
    allMessagesText: 'publish package and update CLI',
    cwd: '/repo/boring-ui',
    updatedAt: '2026-06-21T12:00:00Z',
  },
]

describe('piSessionSearch', () => {
  it('uses pi-style fuzzy matching for session titles and transcript text', () => {
    expect(searchPiSessions(sessions, 'bbp').map((session) => session.id)).toEqual(['session-b'])
    expect(searchPiSessions(sessions, 'sk ov').map((session) => session.id)).toEqual(['session-a'])
  })

  it('supports quoted phrases and regex mode like pi session picker', () => {
    expect(searchPiSessions(sessions, '"catalog search"').map((session) => session.id)).toEqual(['session-b'])
    expect(searchPiSessions(sessions, 're:release|alpha').map((session) => session.id)).toEqual(['session-c', 'session-a'])
  })

  it('returns no results for invalid regex', () => {
    const parsed = parsePiSessionSearchQuery('re:[')
    expect(parsed.error).toBeTruthy()
    expect(searchPiSessions(sessions, 're:[')).toEqual([])
  })
})
