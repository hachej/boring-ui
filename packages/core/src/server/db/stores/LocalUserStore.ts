import { randomUUID } from 'node:crypto'
import type { UserStore } from '../../app/types.js'
import type { User } from '../../../shared/types.js'

interface UserSettings {
  displayName: string
  email: string
  settings: Record<string, unknown>
}

export class LocalUserStore implements UserStore {
  private users = new Map<string, User>()
  private usersByEmail = new Map<string, User>()
  private settings = new Map<string, UserSettings>() // key: `${userId}:${appId}`

  seed(user: Omit<User, 'createdAt' | 'updatedAt'>) {
    const now = new Date().toISOString()
    const full: User = { ...user, createdAt: now, updatedAt: now }
    this.users.set(full.id, full)
    this.usersByEmail.set(full.email.toLowerCase(), full)
  }

  async getById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null
  }

  async getByEmail(email: string): Promise<User | null> {
    return this.usersByEmail.get(email.toLowerCase()) ?? null
  }

  async upsert(userId: string, data: { email: string; name?: string }): Promise<User> {
    const now = new Date().toISOString()
    const existing = this.users.get(userId)
    if (existing) {
      const updated: User = {
        ...existing,
        email: data.email,
        name: data.name ?? existing.name,
        updatedAt: now,
      }
      this.usersByEmail.delete(existing.email.toLowerCase())
      this.users.set(userId, updated)
      this.usersByEmail.set(updated.email.toLowerCase(), updated)
      return updated
    }
    const user: User = {
      id: userId,
      email: data.email,
      name: data.name ?? null,
      emailVerified: false,
      image: null,
      createdAt: now,
      updatedAt: now,
    }
    this.users.set(userId, user)
    this.usersByEmail.set(user.email.toLowerCase(), user)
    return user
  }

  async getUserSettings(userId: string, appId: string): Promise<UserSettings> {
    const key = `${userId}:${appId}`
    const existing = this.settings.get(key)
    if (existing) return { ...existing }
    const user = this.users.get(userId)
    return {
      displayName: user?.name ?? '',
      email: user?.email ?? '',
      settings: {},
    }
  }

  async putUserSettings(
    userId: string,
    appId: string,
    updates: { displayName?: string; email?: string; settings?: Record<string, unknown> },
  ): Promise<UserSettings> {
    const key = `${userId}:${appId}`
    const current = await this.getUserSettings(userId, appId)
    const updated: UserSettings = {
      displayName: updates.displayName ?? current.displayName,
      email: updates.email ?? current.email,
      settings: updates.settings ?? current.settings,
    }
    this.settings.set(key, updated)
    return { ...updated }
  }
}
