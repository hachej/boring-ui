import { readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

/**
 * Stamp the hub's workspace scope on ask-user questions written before the store recorded a
 * workspaceId. The store file lives under the hub's workspace root, so those legacy records belong
 * to the hub; without a workspaceId the tenancy rule would hide the owner's pending gates after an
 * upgrade. Idempotent; never touches questions that already carry a workspaceId.
 */
export async function claimLegacyAskUserQuestions(storePath: string, workspaceScopeId: string): Promise<number> {
  let raw: string
  try {
    raw = await readFile(storePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
  const parsed = JSON.parse(raw) as { questions?: Record<string, { workspaceId?: string }> }
  const questions = parsed.questions
  if (!questions || typeof questions !== 'object') return 0
  let claimed = 0
  for (const question of Object.values(questions)) {
    if (question && typeof question === 'object' && question.workspaceId === undefined) {
      question.workspaceId = workspaceScopeId
      claimed += 1
    }
  }
  if (claimed === 0) return 0
  const temporary = `${storePath}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(parsed, null, 2))
  await rename(temporary, storePath)
  return claimed
}
