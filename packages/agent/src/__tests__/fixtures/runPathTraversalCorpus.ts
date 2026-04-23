import type { Workspace } from '../../shared/workspace'
import { PATH_TRAVERSAL_CORPUS } from './pathTraversalCorpus'

export interface PathTraversalRejection {
  vector: string
  reason: string
}

export interface RunPathTraversalCorpusOptions {
  logRejection?: (entry: PathTraversalRejection) => void
}

export async function runPathTraversalCorpus(
  workspace: Pick<Workspace, 'readFile'>,
  options: RunPathTraversalCorpusOptions = {},
): Promise<void> {
  const accepted: string[] = []

  for (const vector of PATH_TRAVERSAL_CORPUS) {
    try {
      await workspace.readFile(vector)
      accepted.push(vector)
    } catch (error) {
      options.logRejection?.({
        vector,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (accepted.length > 0) {
    throw new Error(
      `Path traversal vectors were accepted: ${accepted.join(', ')}`,
    )
  }
}
