import { render } from '@react-email/render'
import { VerifyEmail } from './VerifyEmail.js'
import { ResetPassword } from './ResetPassword.js'
import { MagicLink } from './MagicLink.js'
import { WorkspaceInvite } from './WorkspaceInvite.js'
import { Welcome } from './Welcome.js'
import type { RenderedEmail } from '../transport.js'

export { VerifyEmail } from './VerifyEmail.js'
export { ResetPassword } from './ResetPassword.js'
export { MagicLink } from './MagicLink.js'
export { WorkspaceInvite } from './WorkspaceInvite.js'
export { Welcome } from './Welcome.js'
export { Layout } from './Layout.js'

interface VerifyEmailData {
  to: string
  verifyUrl: string
  appName: string
  expiresInHours: number
}

export async function renderVerifyEmail(
  data: VerifyEmailData,
): Promise<RenderedEmail> {
  const element = VerifyEmail({
    verifyUrl: data.verifyUrl,
    appName: data.appName,
    expiresInHours: data.expiresInHours,
  })
  return {
    to: data.to,
    subject: `Verify your ${data.appName} email address`,
    html: await render(element),
    text: await render(element, { plainText: true }),
  }
}

interface ResetPasswordData {
  to: string
  resetUrl: string
  appName: string
  expiresInHours: number
}

export async function renderResetPassword(
  data: ResetPasswordData,
): Promise<RenderedEmail> {
  const element = ResetPassword({
    resetUrl: data.resetUrl,
    appName: data.appName,
    expiresInHours: data.expiresInHours,
  })
  return {
    to: data.to,
    subject: `Reset your ${data.appName} password`,
    html: await render(element),
    text: await render(element, { plainText: true }),
  }
}

interface MagicLinkData {
  to: string
  loginUrl: string
  appName: string
  expiresInMinutes: number
}

export async function renderMagicLink(
  data: MagicLinkData,
): Promise<RenderedEmail> {
  const element = MagicLink({
    loginUrl: data.loginUrl,
    appName: data.appName,
    expiresInMinutes: data.expiresInMinutes,
  })
  return {
    to: data.to,
    subject: `Sign in to ${data.appName}`,
    html: await render(element),
    text: await render(element, { plainText: true }),
  }
}

interface WorkspaceInviteData {
  to: string
  acceptUrl: string
  appName: string
  inviterName: string
  workspaceName: string
  role: string
  expiresInDays: number
}

export async function renderWorkspaceInvite(
  data: WorkspaceInviteData,
): Promise<RenderedEmail> {
  const element = WorkspaceInvite({
    acceptUrl: data.acceptUrl,
    appName: data.appName,
    inviterName: data.inviterName,
    workspaceName: data.workspaceName,
    role: data.role,
    expiresInDays: data.expiresInDays,
  })
  return {
    to: data.to,
    subject: `${data.inviterName} invited you to ${data.workspaceName}`,
    html: await render(element),
    text: await render(element, { plainText: true }),
  }
}

interface WelcomeData {
  to: string
  appName: string
  getStartedUrl: string
}

export async function renderWelcome(
  data: WelcomeData,
): Promise<RenderedEmail> {
  const element = Welcome({
    appName: data.appName,
    getStartedUrl: data.getStartedUrl,
  })
  return {
    to: data.to,
    subject: `Welcome to ${data.appName}`,
    html: await render(element),
    text: await render(element, { plainText: true }),
  }
}
