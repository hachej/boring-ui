import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  createBwrapSandbox,
  createNodeWorkspace,
  REMOTE_WORKER_RUNTIME_CWD,
  type BwrapResourceLimits,
  type RemoteWorkerWorkspaceOp,
  type RemoteWorkerWorkspaceResult,
} from '../index'
import type { Sandbox, Workspace } from '../../shared/index'
import { WORKER_ERROR_CODES } from './error-codes'

export interface WorkerRuntime {
  workspace: Workspace
  sandbox: Sandbox
}

const WORKSPACE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function assertSafeWorkspaceId(workspaceId: string): string {
  const normalized = workspaceId.trim().toLowerCase()
  if (!WORKSPACE_UUID.test(normalized)) {
    throw Object.assign(new Error('workspace id must be a uuid'), { statusCode: 400, code: WORKER_ERROR_CODES.INVALID_WORKSPACE_ID })
  }
  return normalized
}

export async function createWorkerRuntime(
  root: string,
  workspaceId: string,
  options: { bwrapNetwork: 'isolated' | 'shared'; resourceLimits?: BwrapResourceLimits },
): Promise<WorkerRuntime> {
  const safeId = assertSafeWorkspaceId(workspaceId)
  const hostRoot = join(root, safeId)
  await mkdir(hostRoot, { recursive: true })
  const workspace = createNodeWorkspace(hostRoot, { runtimeContext: { runtimeCwd: REMOTE_WORKER_RUNTIME_CWD } })
  const sandbox = createBwrapSandbox({
    hostWorkspaceRoot: hostRoot,
    runtimeContext: { runtimeCwd: REMOTE_WORKER_RUNTIME_CWD },
    network: options.bwrapNetwork,
    dropAllCapabilities: true,
    resourceLimits: options.resourceLimits,
  })
  await sandbox.init?.({ workspace, sessionId: safeId })
  return { workspace, sandbox }
}

export async function runWorkspaceOp(workspace: Workspace, op: RemoteWorkerWorkspaceOp): Promise<RemoteWorkerWorkspaceResult> {
  switch (op.op) {
    case 'readFile':
      return { content: await workspace.readFile(op.path) }
    case 'readBinaryFile':
      if (!workspace.readBinaryFile) throw Object.assign(new Error('binary read unsupported'), { statusCode: 501, code: WORKER_ERROR_CODES.NOT_IMPLEMENTED })
      return { dataBase64: Buffer.from(await workspace.readBinaryFile(op.path)).toString('base64') }
    case 'writeFile':
      await workspace.writeFile(op.path, op.data)
      return { ok: true }
    case 'writeBinaryFile':
      if (!workspace.writeBinaryFile) throw Object.assign(new Error('binary write unsupported'), { statusCode: 501, code: WORKER_ERROR_CODES.NOT_IMPLEMENTED })
      await workspace.writeBinaryFile(op.path, new Uint8Array(Buffer.from(op.dataBase64, 'base64')))
      return { ok: true }
    case 'readFileWithStat':
      if (!workspace.readFileWithStat) {
        return { content: await workspace.readFile(op.path), stat: await workspace.stat(op.path) }
      }
      return await workspace.readFileWithStat(op.path)
    case 'writeFileWithStat':
      if (!workspace.writeFileWithStat) {
        await workspace.writeFile(op.path, op.data)
        return { stat: await workspace.stat(op.path) }
      }
      return { stat: await workspace.writeFileWithStat(op.path, op.data) }
    case 'writeBinaryFileWithStat':
      if (!workspace.writeBinaryFile) throw Object.assign(new Error('binary write unsupported'), { statusCode: 501, code: WORKER_ERROR_CODES.NOT_IMPLEMENTED })
      if (!workspace.writeBinaryFileWithStat) {
        await workspace.writeBinaryFile(op.path, new Uint8Array(Buffer.from(op.dataBase64, 'base64')))
        return { stat: await workspace.stat(op.path) }
      }
      return { stat: await workspace.writeBinaryFileWithStat(op.path, new Uint8Array(Buffer.from(op.dataBase64, 'base64'))) }
    case 'unlink':
      await workspace.unlink(op.path)
      return { ok: true }
    case 'readdir':
      return { entries: await workspace.readdir(op.path) }
    case 'stat':
      return { stat: await workspace.stat(op.path) }
    case 'mkdir':
      await workspace.mkdir(op.path, { recursive: op.recursive })
      return { ok: true }
    case 'rename':
      await workspace.rename(op.from, op.to)
      return { ok: true }
    default: {
      const _never: never = op
      throw Object.assign(new Error(`unsupported workspace op ${(op as { op?: string }).op ?? 'unknown'}`), {
        statusCode: 400,
        code: WORKER_ERROR_CODES.UNSUPPORTED_WORKSPACE_OP,
        details: _never,
      })
    }
  }
}
