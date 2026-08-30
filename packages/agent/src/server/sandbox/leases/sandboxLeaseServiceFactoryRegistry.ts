import { SandboxLeaseServiceRegistry } from './sandboxLeaseServiceRegistry'

/** @deprecated Compatibility name; construction and disposal share one lifecycle registry. */
export class SandboxLeaseServiceFactoryRegistry extends SandboxLeaseServiceRegistry {}
