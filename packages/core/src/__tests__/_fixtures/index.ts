import { afterEach } from 'vitest'
import type {
  MemberRole,
  User,
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
} from '../../shared/index.js'

interface FixtureState {
  users: User[]
  workspaces: Workspace[]
  memberships: WorkspaceMember[]
  invites: Array<{ invite: WorkspaceInvite; rawToken: string }>
}

const state: FixtureState = {
  users: [],
  workspaces: [],
  memberships: [],
  invites: [],
}

function nowIso(): string {
  return new Date().toISOString()
}

function randomId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
}

export function getFixtureSnapshot(): FixtureState {
  return {
    users: [...state.users],
    workspaces: [...state.workspaces],
    memberships: [...state.memberships],
    invites: [...state.invites],
  }
}

export async function seedUser(
  opts: { email?: string; name?: string } = {},
): Promise<User> {
  const index = state.users.length + 1
  const user: User = {
    id: randomId('user'),
    email: opts.email ?? `user${index}@test.dev`,
    name: opts.name ?? `User ${index}`,
    emailVerified: true,
    image: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  state.users.push(user)
  return user
}

export async function seedWorkspace(
  ownerId: string,
  opts: { name?: string; appId?: string } = {},
): Promise<Workspace> {
  const workspace: Workspace = {
    id: randomId('workspace'),
    appId: opts.appId ?? 'boring-ui-v2-test',
    workspaceTypeId: 'default',
    name: opts.name ?? 'Default workspace',
    createdBy: ownerId,
    createdAt: nowIso(),
    deletedAt: null,
    isDefault: state.workspaces.length === 0,
  }
  state.workspaces.push(workspace)
  await seedMembership(workspace.id, ownerId, 'owner')
  return workspace
}

export async function seedMembership(
  workspaceId: string,
  userId: string,
  role: MemberRole,
): Promise<WorkspaceMember> {
  const existingIndex = state.memberships.findIndex(
    (m) => m.workspaceId === workspaceId && m.userId === userId,
  )
  const membership: WorkspaceMember = {
    workspaceId,
    userId,
    role,
    createdAt: nowIso(),
  }

  if (existingIndex >= 0) {
    state.memberships[existingIndex] = membership
  } else {
    state.memberships.push(membership)
  }
  return membership
}

export async function seedInvite(
  workspaceId: string,
  email: string,
  role: MemberRole,
): Promise<{ invite: WorkspaceInvite; rawToken: string }> {
  const rawToken = randomId('invite-token')
  const invite: WorkspaceInvite = {
    id: randomId('invite'),
    workspaceId,
    email,
    tokenHash: `sha256:${rawToken}`,
    role,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    acceptedAt: null,
    createdBy: null,
    createdAt: nowIso(),
    failedAttempts: 0,
    lockedUntil: null,
  }
  const result = { invite, rawToken }
  state.invites.push(result)
  return result
}

export function clearFixtures(): void {
  state.users.length = 0
  state.workspaces.length = 0
  state.memberships.length = 0
  state.invites.length = 0
}

afterEach(() => {
  clearFixtures()
})
