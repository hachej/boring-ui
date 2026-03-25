/**
 * File HTTP routes — delegates to FileService.
 * Stub — implementation in Phase 2.
 */
import type { FastifyInstance } from 'fastify'
import type { FileService } from '../services/files.js'

export async function registerFileRoutes(
  _app: FastifyInstance,
  _fileService: FileService,
): Promise<void> {
  throw new Error('Not implemented — see Phase 2: Files HTTP routes')
}
