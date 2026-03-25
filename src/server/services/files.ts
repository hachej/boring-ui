/**
 * File service — transport-independent business logic for file operations.
 * Mirrors Python's modules/files/service.py.
 */
import type {
  FileListResult,
  FileReadResult,
  FileWriteResult,
  FileDeleteResult,
  FileRenameResult,
  FileMoveResult,
  FileSearchResult,
} from '../../shared/types.js'

export interface FileServiceDeps {
  workspaceRoot: string
}

export interface FileService {
  listDirectory(path?: string): Promise<FileListResult>
  readFile(path: string): Promise<FileReadResult>
  writeFile(path: string, content: string): Promise<FileWriteResult>
  deleteFile(path: string): Promise<FileDeleteResult>
  renameFile(oldPath: string, newPath: string): Promise<FileRenameResult>
  moveFile(srcPath: string, destDir: string): Promise<FileMoveResult>
  searchFiles(pattern: string, path?: string): Promise<FileSearchResult>
}

export function createFileService(_deps: FileServiceDeps): FileService {
  throw new Error('Not implemented — see bd-qvv02 (Phase 2: Files service)')
}
