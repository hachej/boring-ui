import { ERROR_CODES, HttpError } from '../shared/errors.js'
import {
  DEFAULT_WORKSPACE_TYPE_ID,
  isWorkspaceTypeId,
} from '../shared/workspaceType.js'

export function parseTrustedWorkspaceTypeId(value: unknown): string {
  const workspaceTypeId = value === undefined ? DEFAULT_WORKSPACE_TYPE_ID : value
  if (!isWorkspaceTypeId(workspaceTypeId)) {
    throw new HttpError({
      status: 400,
      code: ERROR_CODES.INVALID_WORKSPACE_TYPE_ID,
      message: 'Invalid workspace type ID',
    })
  }
  return workspaceTypeId
}

export function assertWorkspaceTypeIdNotMutable(
  input: unknown,
  requestId?: string,
): void {
  if (
    input !== null
    && typeof input === 'object'
    && Object.prototype.hasOwnProperty.call(input, 'workspaceTypeId')
  ) {
    throw new HttpError({
      status: 400,
      code: ERROR_CODES.WORKSPACE_TYPE_IMMUTABLE,
      message: 'workspaceTypeId is server-controlled and immutable',
      requestId,
    })
  }
}

export function assertWorkspaceTypeIdMatches(
  persistedWorkspaceTypeId: string,
  requestedWorkspaceTypeId: string,
): void {
  if (persistedWorkspaceTypeId !== requestedWorkspaceTypeId) {
    throw new HttpError({
      status: 409,
      code: ERROR_CODES.WORKSPACE_TYPE_IMMUTABLE,
      message: 'workspaceTypeId cannot be changed after creation',
    })
  }
}
