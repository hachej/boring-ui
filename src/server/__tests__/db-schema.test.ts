/**
 * TDD tests for bd-fus66: Database schema validation.
 *
 * Validates the Drizzle ORM schema matches the expected Neon DB structure.
 * Does NOT require a database connection — tests the schema definition.
 */
import { describe, it, expect } from 'vitest'
import {
  workspaces,
  workspaceRuntimes,
  workspaceInvites,
  workspaceSettings,
  workspaceMembers,
  userSettings,
} from '../db/schema.js'
import { getTableName, getTableColumns } from 'drizzle-orm'

describe('Database schema tables', () => {
  it('exports all 6 expected tables', () => {
    expect(workspaces).toBeDefined()
    expect(workspaceRuntimes).toBeDefined()
    expect(workspaceInvites).toBeDefined()
    expect(workspaceSettings).toBeDefined()
    expect(workspaceMembers).toBeDefined()
    expect(userSettings).toBeDefined()
  })

  it('table names match expected', () => {
    expect(getTableName(workspaces)).toBe('workspaces')
    expect(getTableName(workspaceRuntimes)).toBe('workspace_runtimes')
    expect(getTableName(workspaceInvites)).toBe('workspace_invites')
    expect(getTableName(workspaceSettings)).toBe('workspace_settings')
    expect(getTableName(workspaceMembers)).toBe('workspace_members')
    expect(getTableName(userSettings)).toBe('user_settings')
  })
})

describe('workspaces table', () => {
  it('has required columns', () => {
    const cols = getTableColumns(workspaces)
    expect(cols.id).toBeDefined()
    expect(cols.appId).toBeDefined()
    expect(cols.name).toBeDefined()
    expect(cols.createdBy).toBeDefined()
    expect(cols.createdAt).toBeDefined()
    expect(cols.isDefault).toBeDefined()
  })

  it('has deployment columns', () => {
    const cols = getTableColumns(workspaces)
    expect(cols.machineId).toBeDefined()
    expect(cols.volumeId).toBeDefined()
    expect(cols.flyRegion).toBeDefined()
  })
})

describe('workspace_members table', () => {
  it('has composite primary key columns', () => {
    const cols = getTableColumns(workspaceMembers)
    expect(cols.workspaceId).toBeDefined()
    expect(cols.userId).toBeDefined()
    expect(cols.role).toBeDefined()
  })
})

describe('workspace_settings table', () => {
  it('has encrypted value column (bytea)', () => {
    const cols = getTableColumns(workspaceSettings)
    expect(cols.workspaceId).toBeDefined()
    expect(cols.key).toBeDefined()
    expect(cols.value).toBeDefined()
  })
})

describe('user_settings table', () => {
  it('has settings JSONB column', () => {
    const cols = getTableColumns(userSettings)
    expect(cols.userId).toBeDefined()
    expect(cols.appId).toBeDefined()
    expect(cols.settings).toBeDefined()
    expect(cols.email).toBeDefined()
    expect(cols.displayName).toBeDefined()
  })
})

describe('workspace_runtimes table', () => {
  it('has provisioning state columns', () => {
    const cols = getTableColumns(workspaceRuntimes)
    expect(cols.workspaceId).toBeDefined()
    expect(cols.state).toBeDefined()
    expect(cols.spriteUrl).toBeDefined()
    expect(cols.provisioningStep).toBeDefined()
  })
})

describe('workspace_invites table', () => {
  it('has invite columns', () => {
    const cols = getTableColumns(workspaceInvites)
    expect(cols.id).toBeDefined()
    expect(cols.workspaceId).toBeDefined()
    expect(cols.email).toBeDefined()
    expect(cols.tokenHash).toBeDefined()
    expect(cols.role).toBeDefined()
    expect(cols.expiresAt).toBeDefined()
  })
})
