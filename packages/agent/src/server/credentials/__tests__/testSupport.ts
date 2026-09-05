import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function createTemporaryCredentialAnchorPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'credential-route-clean-anchor-'))
  return join(directory, 'credential-anchor')
}
