// AgentHost supports the production host filesystems plus tmpfs/overlay used by CI and container runtimes.
const SUPPORTED_LOCAL_FILESYSTEMS = new Set([0xef53, 0x58465342, 0x9123683e, 0x01021994, 0x794c7630])

export function isSupportedLocalAgentHostLockFilesystem(type: number | bigint): boolean {
  return SUPPORTED_LOCAL_FILESYSTEMS.has(Number(type) >>> 0)
}
