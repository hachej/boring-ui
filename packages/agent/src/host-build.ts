import type { HostBuild } from './host/contract.js';

/** Built by host-mount-build. Rejects, as its type says. */
export const hostBuild: HostBuild = async () => { throw new Error('not built: host-mount-build'); };
