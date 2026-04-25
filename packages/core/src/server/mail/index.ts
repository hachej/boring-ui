export { createMailTransport, MailDeliveryError } from './transport.js'
export type { MailTransport, RenderedEmail } from './transport.js'

export {
  renderVerifyEmail,
  renderResetPassword,
  renderMagicLink,
  renderWorkspaceInvite,
  renderWelcome,
  Layout,
  VerifyEmail,
  ResetPassword,
  MagicLink,
  WorkspaceInvite,
  Welcome,
} from './templates/index.js'
