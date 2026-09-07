export const BORING_FACTORY_RESOURCE_ERROR_CODES = Object.freeze({
  MANIFEST_INVALID: 'BORING_FACTORY_RESOURCE_MANIFEST_INVALID',
  ROOT_INVALID: 'BORING_FACTORY_RESOURCE_ROOT_INVALID',
  FILE_SET_INVALID: 'BORING_FACTORY_RESOURCE_FILE_SET_INVALID',
  ENTRY_INVALID: 'BORING_FACTORY_RESOURCE_ENTRY_INVALID',
  DIGEST_MISMATCH: 'BORING_FACTORY_RESOURCE_DIGEST_MISMATCH',
  RESOLUTION_FAILED: 'BORING_FACTORY_RESOURCE_RESOLUTION_FAILED',
} as const)

export type BoringFactoryResourceErrorCode =
  (typeof BORING_FACTORY_RESOURCE_ERROR_CODES)[keyof typeof BORING_FACTORY_RESOURCE_ERROR_CODES]

export class BoringFactoryResourceError extends Error {
  readonly code: BoringFactoryResourceErrorCode

  constructor(code: BoringFactoryResourceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BoringFactoryResourceError'
    this.code = code
  }
}
