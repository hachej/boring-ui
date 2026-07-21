import { constants } from 'node:fs'
import { open, realpath, stat, type FileHandle } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import {
  AgentDefinitionValidationError,
  createAgentAssetDigest,
  createAgentDefinitionDigest,
  validateAgentDefinition,
  type AgentDefinition,
  type AgentDefinitionDigestAsset,
  type CompiledAgentBundle,
  type CompiledAgentDefinition,
} from '../../shared/agent-definition'
import { AgentDefinitionErrorCode, ErrorCode } from '../../shared/error-codes'

const AGENT_MANIFEST = 'agent.json'
const AGENT_INSTRUCTIONS = 'instructions.md'
const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_INSTRUCTIONS_BYTES = 256 * 1024

export type AgentDirectoryCompilerErrorCode =
  | 'AGENT_DIRECTORY_NOT_FOUND'
  | 'AGENT_DIRECTORY_NOT_DIRECTORY'
  | 'AGENT_MANIFEST_NOT_FOUND'
  | 'AGENT_MANIFEST_NOT_FILE'
  | 'AGENT_MANIFEST_INVALID_UTF8'
  | 'AGENT_MANIFEST_INVALID_JSON'
  | 'AGENT_ASSET_NOT_FOUND'
  | 'AGENT_ASSET_NOT_FILE'
  | 'AGENT_ASSET_INVALID_UTF8'
  | 'AGENT_PATH_SYMLINK_ESCAPE'
  | 'AGENT_PATH_CHANGED_DURING_READ'
  | 'AGENT_DIRECTORY_IO_FAILED'

export type AgentDirectoryCompilerPublicErrorCode = Extract<
  ErrorCode,
  'CONFIG_INVALID' | 'PATH_NOT_FOUND' | 'PATH_SYMLINK_ESCAPE'
>

export class AgentDirectoryCompilerError extends Error {
  readonly code: AgentDirectoryCompilerPublicErrorCode
  readonly compilerCode: AgentDirectoryCompilerErrorCode
  readonly field: string

  constructor(input: {
    code: AgentDirectoryCompilerPublicErrorCode
    compilerCode: AgentDirectoryCompilerErrorCode
    field: string
    message: string
    cause?: unknown
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause })
    this.name = 'AgentDirectoryCompilerError'
    this.code = input.code
    this.compilerCode = input.compilerCode
    this.field = input.field
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

function isNotFound(error: unknown): boolean {
  return errorCode(error) === 'ENOENT'
}

function isSymlinkRefusal(error: unknown): boolean {
  return errorCode(error) === 'ELOOP'
}

function isInsideRoot(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target)
  return pathFromRoot === '' || (
    pathFromRoot !== '..' &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  )
}

async function resolveAgentRoot(directory: string): Promise<string> {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new AgentDirectoryCompilerError({
      code: ErrorCode.enum.CONFIG_INVALID,
      compilerCode: 'AGENT_DIRECTORY_NOT_DIRECTORY',
      field: 'directory',
      message: 'agent directory must be a non-empty path',
    })
  }

  let root: string
  try {
    root = await realpath(resolve(directory))
  } catch (error) {
    throw new AgentDirectoryCompilerError({
      code: isNotFound(error)
        ? ErrorCode.enum.PATH_NOT_FOUND
        : ErrorCode.enum.CONFIG_INVALID,
      compilerCode: isNotFound(error)
        ? 'AGENT_DIRECTORY_NOT_FOUND'
        : 'AGENT_DIRECTORY_IO_FAILED',
      field: 'directory',
      message: isNotFound(error)
        ? 'agent directory does not exist'
        : 'agent directory could not be resolved',
      cause: error,
    })
  }

  try {
    if (!(await stat(root)).isDirectory()) {
      throw new AgentDirectoryCompilerError({
        code: ErrorCode.enum.CONFIG_INVALID,
        compilerCode: 'AGENT_DIRECTORY_NOT_DIRECTORY',
        field: 'directory',
        message: 'agent directory path must name a directory',
      })
    }
  } catch (error) {
    if (error instanceof AgentDirectoryCompilerError) throw error
    throw new AgentDirectoryCompilerError({
      code: isNotFound(error)
        ? ErrorCode.enum.PATH_NOT_FOUND
        : ErrorCode.enum.CONFIG_INVALID,
      compilerCode: isNotFound(error)
        ? 'AGENT_DIRECTORY_NOT_FOUND'
        : 'AGENT_DIRECTORY_IO_FAILED',
      field: 'directory',
      message: 'agent directory could not be inspected',
      cause: error,
    })
  }

  return root
}

interface ReadContainedFileOptions {
  root: string
  path: string
  field: 'agent.json' | 'instructionsRef'
  kind: 'manifest' | 'asset'
  maxBytes: number
}

function definitionTooLarge(field: ReadContainedFileOptions['field'], maxBytes: number): never {
  throw new AgentDefinitionValidationError({
    code: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
    field,
    message: `${field} must be at most ${maxBytes} bytes`,
  })
}

async function readBounded(
  handle: FileHandle,
  field: ReadContainedFileOptions['field'],
  maxBytes: number,
): Promise<Uint8Array> {
  const bytes = new Uint8Array(maxBytes + 1)
  let offset = 0
  while (offset < bytes.length) {
    const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  if (offset > maxBytes) definitionTooLarge(field, maxBytes)
  return bytes.subarray(0, offset)
}

interface FileSnapshot {
  dev: number | bigint
  ino: number | bigint
  size: number | bigint
  mtimeMs: number | bigint
  ctimeMs: number | bigint
}

function sameFileIdentity(left: FileSnapshot, right: FileSnapshot): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function sameFileVersion(left: FileSnapshot, right: FileSnapshot): boolean {
  return (
    sameFileIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  )
}

function pathChangedDuringRead(field: ReadContainedFileOptions['field']): never {
  throw new AgentDirectoryCompilerError({
    code: ErrorCode.enum.CONFIG_INVALID,
    compilerCode: 'AGENT_PATH_CHANGED_DURING_READ',
    field,
    message: `${field} changed while it was being read`,
  })
}

async function readContainedFile({
  root,
  path,
  field,
  kind,
  maxBytes,
}: ReadContainedFileOptions): Promise<Uint8Array> {
  const candidate = resolve(root, path)
  if (!isInsideRoot(root, candidate)) {
    throw new AgentDirectoryCompilerError({
      code: ErrorCode.enum.PATH_SYMLINK_ESCAPE,
      compilerCode: 'AGENT_PATH_SYMLINK_ESCAPE',
      field,
      message: `${field} resolves outside the agent directory`,
    })
  }

  let handle: FileHandle
  try {
    handle = await open(
      candidate,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    )
  } catch (error) {
    if (isSymlinkRefusal(error)) {
      throw new AgentDirectoryCompilerError({
        code: ErrorCode.enum.PATH_SYMLINK_ESCAPE,
        compilerCode: 'AGENT_PATH_SYMLINK_ESCAPE',
        field,
        message: `${field} must not be a symbolic link`,
        cause: error,
      })
    }
    throw new AgentDirectoryCompilerError({
      code: isNotFound(error)
        ? ErrorCode.enum.PATH_NOT_FOUND
        : ErrorCode.enum.CONFIG_INVALID,
      compilerCode: isNotFound(error)
        ? kind === 'manifest'
          ? 'AGENT_MANIFEST_NOT_FOUND'
          : 'AGENT_ASSET_NOT_FOUND'
        : 'AGENT_DIRECTORY_IO_FAILED',
      field,
      message: isNotFound(error)
        ? `${field} does not exist`
        : `${field} could not be opened`,
      cause: error,
    })
  }

  try {
    const openedStat = await handle.stat()
    if (!openedStat.isFile()) {
      throw new AgentDirectoryCompilerError({
        code: ErrorCode.enum.CONFIG_INVALID,
        compilerCode: kind === 'manifest'
          ? 'AGENT_MANIFEST_NOT_FILE'
          : 'AGENT_ASSET_NOT_FILE',
        field,
        message: `${field} must name a file`,
      })
    }

    if (openedStat.size > maxBytes) definitionTooLarge(field, maxBytes)

    const target = await realpath(candidate)
    if (!isInsideRoot(root, target)) {
      throw new AgentDirectoryCompilerError({
        code: ErrorCode.enum.PATH_SYMLINK_ESCAPE,
        compilerCode: 'AGENT_PATH_SYMLINK_ESCAPE',
        field,
        message: `${field} resolves outside the agent directory`,
      })
    }

    const targetStat = await stat(target)
    if (!sameFileIdentity(openedStat, targetStat)) pathChangedDuringRead(field)

    const bytes = await readBounded(handle, field, maxBytes)
    const readStat = await handle.stat()
    const readTarget = await realpath(candidate)
    const readTargetStat = await stat(readTarget)
    if (
      target !== readTarget ||
      !sameFileVersion(openedStat, readStat) ||
      !sameFileIdentity(readStat, readTargetStat)
    ) pathChangedDuringRead(field)

    return bytes
  } catch (error) {
    if (
      error instanceof AgentDirectoryCompilerError ||
      error instanceof AgentDefinitionValidationError
    ) throw error
    throw new AgentDirectoryCompilerError({
      code: isNotFound(error)
        ? ErrorCode.enum.PATH_NOT_FOUND
        : ErrorCode.enum.CONFIG_INVALID,
      compilerCode: isNotFound(error)
        ? kind === 'manifest'
          ? 'AGENT_MANIFEST_NOT_FOUND'
          : 'AGENT_ASSET_NOT_FOUND'
        : 'AGENT_DIRECTORY_IO_FAILED',
      field,
      message: `${field} could not be read`,
      cause: error,
    })
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function decodeUtf8(
  bytes: Uint8Array,
  field: 'agent.json' | 'instructionsRef',
): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new AgentDirectoryCompilerError({
      code: ErrorCode.enum.CONFIG_INVALID,
      compilerCode: field === 'agent.json'
        ? 'AGENT_MANIFEST_INVALID_UTF8'
        : 'AGENT_ASSET_INVALID_UTF8',
      field,
      message: `${field} must contain valid UTF-8`,
      cause: error,
    })
  }
}

function parseManifest(content: string): unknown {
  try {
    return JSON.parse(content) as unknown
  } catch (error) {
    throw new AgentDirectoryCompilerError({
      code: ErrorCode.enum.CONFIG_INVALID,
      compilerCode: 'AGENT_MANIFEST_INVALID_JSON',
      field: 'agent.json',
      message: 'agent.json must contain valid JSON',
      cause: error,
    })
  }
}

function freezeDefinition(definition: AgentDefinition): CompiledAgentDefinition {
  return Object.freeze({
    schemaVersion: definition.schemaVersion,
    definitionId: definition.definitionId,
    version: definition.version,
    ...(definition.label === undefined ? {} : { label: definition.label }),
    ...(definition.description === undefined ? {} : { description: definition.description }),
    instructionsRef: definition.instructionsRef,
  })
}

export async function compileAgentDirectory(directory: string): Promise<CompiledAgentBundle> {
  const root = await resolveAgentRoot(directory)
  const manifestContent = decodeUtf8(await readContainedFile({
    root,
    path: AGENT_MANIFEST,
    field: 'agent.json',
    kind: 'manifest',
    maxBytes: MAX_MANIFEST_BYTES,
  }), 'agent.json')
  const validation = validateAgentDefinition(parseManifest(manifestContent))
  if (!validation.valid) throw new AgentDefinitionValidationError(validation.issues[0])
  if (validation.value.instructionsRef !== AGENT_INSTRUCTIONS) {
    throw new AgentDefinitionValidationError({
      code: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
      field: 'instructionsRef',
      message: `instructionsRef must be ${JSON.stringify(AGENT_INSTRUCTIONS)} in schema version 1`,
    })
  }

  const instructionsContent = decodeUtf8(await readContainedFile({
    root,
    path: validation.value.instructionsRef,
    field: 'instructionsRef',
    kind: 'asset',
    maxBytes: MAX_INSTRUCTIONS_BYTES,
  }), 'instructionsRef')
  if (instructionsContent.trim().length === 0) {
    throw new AgentDefinitionValidationError({
      code: AgentDefinitionErrorCode.enum.AGENT_DEFINITION_INVALID,
      field: 'instructionsRef',
      message: 'instructions.md must contain non-whitespace instructions',
    })
  }
  const instructionsAsset: AgentDefinitionDigestAsset = Object.freeze({
    path: validation.value.instructionsRef,
    digest: await createAgentAssetDigest(instructionsContent),
    content: instructionsContent,
  })
  const assets = Object.freeze([instructionsAsset])
  const definitionDigest = await createAgentDefinitionDigest({
    definition: validation.value,
    assets,
  })
  const definition = freezeDefinition(validation.value)

  return Object.freeze({ definition, definitionDigest, assets })
}
