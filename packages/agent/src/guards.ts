import type { Extension } from '@earendil-works/pi-durable';

// Extensions that gate or contain calls (approval, sandbox). A delegated child inherits the parent's, so it cannot escape them.
const GUARDS = new WeakSet<object>();
export function markGuard<T extends Extension>(extension: T): T { GUARDS.add(extension); return extension; }
export function isGuard(extension: object): boolean { return GUARDS.has(extension); }
