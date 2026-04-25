import { describe, expect, it } from 'vitest'
import { withBeadId } from '../../server/__tests__/_setup'
import {
  getFixtureSnapshot,
  seedInvite,
  seedMembership,
  seedUser,
  seedWorkspace,
} from './index'

describe('fixtures', () => {
  it(
    'supports seedUser -> seedWorkspace -> seedMembership -> seedInvite',
    withBeadId('boring-ui-v2-eyll', async ({ assertionPassed }) => {
      const owner = await seedUser({ email: 'owner@test.dev', name: 'Owner' })
      const collaborator = await seedUser({
        email: 'collab@test.dev',
        name: 'Collaborator',
      })
      const workspace = await seedWorkspace(owner.id, {
        name: 'Fixture Workspace',
      })
      const membership = await seedMembership(
        workspace.id,
        collaborator.id,
        'editor',
      )
      const invite = await seedInvite(workspace.id, 'invitee@test.dev', 'viewer')

      assertionPassed('fixtures-created')

      const snapshot = getFixtureSnapshot()
      expect(snapshot.users).toHaveLength(2)
      expect(snapshot.workspaces).toHaveLength(1)
      expect(snapshot.memberships).toHaveLength(2) // owner + collaborator
      expect(snapshot.invites).toHaveLength(1)
      expect(membership.role).toBe('editor')
      expect(invite.rawToken.length).toBeGreaterThan(10)
    }),
  )

  it(
    'auto-cleans fixture state after each test',
    withBeadId('boring-ui-v2-eyll', async ({ assertionPassed }) => {
      const snapshot = getFixtureSnapshot()
      assertionPassed('fixtures-cleaned')
      expect(snapshot.users).toHaveLength(0)
      expect(snapshot.workspaces).toHaveLength(0)
      expect(snapshot.memberships).toHaveLength(0)
      expect(snapshot.invites).toHaveLength(0)
    }),
  )
})
