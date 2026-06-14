export { AuthProvider, useSession, useSignIn, useSignUp, useSignOut, useVerifyEmail, useSendVerificationEmail, useChangePassword } from './AuthProvider.js'
export type { AuthProviderProps } from './AuthProvider.js'

export { UserIdentityProvider, useUser } from './UserIdentityProvider.js'
export type { UserIdentity, UserIdentityProviderProps } from './UserIdentityProvider.js'

export { getAuthClient } from './authClient.js'
export type { AuthClient } from './authClient.js'

export { GoogleAuthButton } from './GoogleAuthButton.js'
export type { GoogleAuthButtonProps } from './GoogleAuthButton.js'
export { SignInPage } from './SignInPage.js'
export { SignUpPage } from './SignUpPage.js'
export { ForgotPasswordPage } from './ForgotPasswordPage.js'
export { ResetPasswordPage } from './ResetPasswordPage.js'
export { VerifyEmailPage } from './VerifyEmailPage.js'
export { UserSettingsPage } from './UserSettingsPage.js'
export type { UserSettingsPageProps, UserSettingsSection } from './UserSettingsPage.js'
export { InviteAcceptPage } from './InviteAcceptPage.js'
