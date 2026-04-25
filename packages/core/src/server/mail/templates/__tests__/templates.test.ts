import { describe, it, expect } from 'vitest'
import {
  renderVerifyEmail,
  renderResetPassword,
  renderMagicLink,
  renderWorkspaceInvite,
  renderWelcome,
} from '../index'

describe('renderVerifyEmail', () => {
  it('renders HTML with verify link', async () => {
    const email = await renderVerifyEmail({
      to: 'user@test.dev',
      verifyUrl: 'https://app.test/verify?token=abc',
      appName: 'TestApp',
      expiresInHours: 24,
    })

    expect(email.to).toBe('user@test.dev')
    expect(email.subject).toBe('Verify your TestApp email address')
    expect(email.html).toContain('Verify your email address')
    expect(email.html).toContain('https://app.test/verify?token=abc')
    expect(email.text).toContain('Verify email')
    expect(email.text).toContain('24 hours')
  })

  it('uses singular "hour" for expiresInHours=1', async () => {
    const email = await renderVerifyEmail({
      to: 'user@test.dev',
      verifyUrl: 'https://app.test/verify',
      appName: 'TestApp',
      expiresInHours: 1,
    })

    expect(email.text).toContain('1 hour')
    expect(email.text).not.toContain('1 hours')
  })
})

describe('renderResetPassword', () => {
  it('renders HTML with reset link', async () => {
    const email = await renderResetPassword({
      to: 'user@test.dev',
      resetUrl: 'https://app.test/reset?token=xyz',
      appName: 'TestApp',
      expiresInHours: 2,
    })

    expect(email.to).toBe('user@test.dev')
    expect(email.subject).toBe('Reset your TestApp password')
    expect(email.html).toContain('Reset your password')
    expect(email.html).toContain('https://app.test/reset?token=xyz')
    expect(email.text).toContain('Reset password')
    expect(email.text).toContain('2 hours')
  })
})

describe('renderMagicLink', () => {
  it('renders HTML with login link', async () => {
    const email = await renderMagicLink({
      to: 'user@test.dev',
      loginUrl: 'https://app.test/magic?token=m1',
      appName: 'TestApp',
      expiresInMinutes: 15,
    })

    expect(email.to).toBe('user@test.dev')
    expect(email.subject).toBe('Sign in to TestApp')
    expect(email.html).toContain('https://app.test/magic?token=m1')
    expect(email.text).toContain('Sign in')
    expect(email.text).toContain('15 minutes')
  })

  it('uses singular "minute" for expiresInMinutes=1', async () => {
    const email = await renderMagicLink({
      to: 'user@test.dev',
      loginUrl: 'https://app.test/magic',
      appName: 'TestApp',
      expiresInMinutes: 1,
    })

    expect(email.text).toContain('1 minute')
    expect(email.text).not.toContain('1 minutes')
  })
})

describe('renderWorkspaceInvite', () => {
  it('renders HTML with invite details', async () => {
    const email = await renderWorkspaceInvite({
      to: 'invitee@test.dev',
      acceptUrl: 'https://app.test/invite/accept?token=inv1',
      inviterName: 'Alice',
      workspaceName: 'Acme Corp',
      role: 'editor',
      expiresInDays: 7,
    })

    expect(email.to).toBe('invitee@test.dev')
    expect(email.subject).toBe('Alice invited you to Acme Corp')
    expect(email.html).toContain('Alice')
    expect(email.html).toContain('Acme Corp')
    expect(email.html).toContain('editor')
    expect(email.html).toContain('https://app.test/invite/accept?token=inv1')
    expect(email.text).toContain('Accept invitation')
    expect(email.text).toContain('7 days')
  })

  it('uses singular "day" for expiresInDays=1', async () => {
    const email = await renderWorkspaceInvite({
      to: 'invitee@test.dev',
      acceptUrl: 'https://app.test/invite',
      inviterName: 'Bob',
      workspaceName: 'Team',
      role: 'viewer',
      expiresInDays: 1,
    })

    expect(email.text).toContain('1 day')
    expect(email.text).not.toContain('1 days')
  })
})

describe('renderWelcome', () => {
  it('renders HTML with get-started link', async () => {
    const email = await renderWelcome({
      to: 'newuser@test.dev',
      appName: 'TestApp',
      getStartedUrl: 'https://app.test/dashboard',
    })

    expect(email.to).toBe('newuser@test.dev')
    expect(email.subject).toBe('Welcome to TestApp')
    expect(email.html).toContain('https://app.test/dashboard')
    expect(email.text).toContain('Get started')
    expect(email.text).toContain('Welcome to TestApp')
  })
})

describe('plaintext output', () => {
  it('all templates produce non-empty plaintext and valid HTML', async () => {
    const emails = await Promise.all([
      renderVerifyEmail({
        to: 'a@t.dev',
        verifyUrl: 'https://x',
        appName: 'A',
        expiresInHours: 1,
      }),
      renderResetPassword({
        to: 'b@t.dev',
        resetUrl: 'https://x',
        appName: 'A',
        expiresInHours: 1,
      }),
      renderMagicLink({
        to: 'c@t.dev',
        loginUrl: 'https://x',
        appName: 'A',
        expiresInMinutes: 5,
      }),
      renderWorkspaceInvite({
        to: 'd@t.dev',
        acceptUrl: 'https://x',
        inviterName: 'X',
        workspaceName: 'W',
        role: 'admin',
        expiresInDays: 3,
      }),
      renderWelcome({
        to: 'e@t.dev',
        appName: 'A',
        getStartedUrl: 'https://x',
      }),
    ])

    for (const email of emails) {
      expect(email.text.length).toBeGreaterThan(10)
      expect(email.html).toContain('<!DOCTYPE')
    }
  })
})
