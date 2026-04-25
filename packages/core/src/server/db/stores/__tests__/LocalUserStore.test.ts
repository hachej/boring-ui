import { describe, it, expect, beforeEach } from 'vitest'
import { LocalUserStore } from '../LocalUserStore'

let store: LocalUserStore

beforeEach(() => {
  store = new LocalUserStore()
})

describe('LocalUserStore', () => {
  it('getById returns null for unknown id', async () => {
    expect(await store.getById('unknown')).toBeNull()
  })

  it('getByEmail returns null for unknown email', async () => {
    expect(await store.getByEmail('unknown@test.com')).toBeNull()
  })

  it('upsert creates a new user', async () => {
    const user = await store.upsert('u1', { email: 'alice@test.com', name: 'Alice' })
    expect(user.id).toBe('u1')
    expect(user.email).toBe('alice@test.com')
    expect(user.name).toBe('Alice')
    expect(user.emailVerified).toBe(false)
  })

  it('upsert updates an existing user', async () => {
    await store.upsert('u1', { email: 'alice@test.com', name: 'Alice' })
    const updated = await store.upsert('u1', { email: 'alice2@test.com', name: 'Alice2' })
    expect(updated.email).toBe('alice2@test.com')
    expect(updated.name).toBe('Alice2')
  })

  it('getById finds user after upsert', async () => {
    await store.upsert('u1', { email: 'alice@test.com' })
    const found = await store.getById('u1')
    expect(found?.email).toBe('alice@test.com')
  })

  it('getByEmail is case-insensitive', async () => {
    await store.upsert('u1', { email: 'Alice@Test.com' })
    const found = await store.getByEmail('alice@test.com')
    expect(found?.id).toBe('u1')
  })

  it('seed creates user with emailVerified true', () => {
    store.seed({ id: 'dev-local', email: 'dev@local', name: 'Dev', emailVerified: true, image: null })
    return store.getById('dev-local').then(u => {
      expect(u?.emailVerified).toBe(true)
      expect(u?.name).toBe('Dev')
    })
  })

  it('getUserSettings returns defaults for new user', async () => {
    await store.upsert('u1', { email: 'a@b.com', name: 'A' })
    const settings = await store.getUserSettings('u1', 'app1')
    expect(settings.displayName).toBe('A')
    expect(settings.email).toBe('a@b.com')
    expect(settings.settings).toEqual({})
  })

  it('putUserSettings updates and returns settings', async () => {
    await store.upsert('u1', { email: 'a@b.com' })
    const updated = await store.putUserSettings('u1', 'app1', {
      displayName: 'Bob',
      settings: { theme: 'dark' },
    })
    expect(updated.displayName).toBe('Bob')
    expect(updated.settings).toEqual({ theme: 'dark' })
  })

  it('settings are scoped by (userId, appId)', async () => {
    await store.upsert('u1', { email: 'a@b.com' })
    await store.putUserSettings('u1', 'app1', { displayName: 'App1Name' })
    await store.putUserSettings('u1', 'app2', { displayName: 'App2Name' })
    expect((await store.getUserSettings('u1', 'app1')).displayName).toBe('App1Name')
    expect((await store.getUserSettings('u1', 'app2')).displayName).toBe('App2Name')
  })

  it('upsert updates email index correctly', async () => {
    await store.upsert('u1', { email: 'old@test.com' })
    await store.upsert('u1', { email: 'new@test.com' })
    expect(await store.getByEmail('old@test.com')).toBeNull()
    expect((await store.getByEmail('new@test.com'))?.id).toBe('u1')
  })
})
