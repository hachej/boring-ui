import type { CoreConfig, RuntimeConfig, User } from './types.js'

export function isCoreEmailVerificationEnabled(
  config: Pick<CoreConfig, 'auth'>,
): boolean {
  return Boolean(config.auth.mail)
}

export function isRuntimeEmailVerificationEnabled(
  config: Pick<RuntimeConfig, 'features'> | null | undefined,
): boolean {
  return config?.features.emailVerification === true
}

export function canUseProtectedApi(
  user: Pick<User, 'emailVerified'> | null | undefined,
  requireEmailVerification: boolean,
): boolean {
  if (!user) return false
  return !requireEmailVerification || user.emailVerified === true
}
