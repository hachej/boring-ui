export function readUiReviewWorktreeIdentity(cwd?: string): Promise<{
  root: string
  revision: string
  treeHash: string
}>
