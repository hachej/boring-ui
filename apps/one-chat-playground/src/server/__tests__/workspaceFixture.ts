import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  createSandboxRuntimeModeAdapter,
  type RuntimeBundle,
} from '@hachej/boring-agent/server'

import type { AgreementSections } from '../memoryFiles'

export const TEST_REAL_CASES = ['Late invoice for Marie', 'Paid invoice for Léo', 'Overdue invoice for Sam']
export const TEST_AGREEMENT: AgreementSections = {
  observation: 'Invoices are hard to follow.',
  objective: 'Find an invoice in under one minute, measured on the real cases.',
  whoAndWhen: 'The owner, at the end of the week.',
  appRole: "I update invoice status; I don't send email.",
  productSentence: 'One place to follow invoices.',
  journey: 'Open, find, update.',
  outOfScope: '| Out of scope | Why |\n| --- | --- |\n| Email | Not available |',
  acceptance: '1. Case 1: late → shown late.\n2. Case 2: paid → shown paid.\n3. Case 3: overdue → delay shown.',
  knownLimits: 'One person.',
  openQuestions: 'None.',
}

export async function workspaceFixture(
  prefix: string,
  workspaceRoot?: string,
): Promise<RuntimeBundle> {
  const root = workspaceRoot ?? (await mkdtemp(path.join(os.tmpdir(), prefix)))
  return await createSandboxRuntimeModeAdapter('direct').create({
    workspaceRoot: root,
    workspaceId: prefix,
    sessionId: prefix,
  })
}
