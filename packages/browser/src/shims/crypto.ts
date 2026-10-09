// Browser stand-in for the `node:crypto` calls bundled code makes. `randomUUID` comes from the one owner of
// secure-context-only APIs (`@hachej/boring-files/platform`), which also works on plain-HTTP pages.
import { randomUUID } from '@hachej/boring-files/platform';

export const randomBytes = (size: number): Uint8Array => { const bytes = new Uint8Array(size); globalThis.crypto.getRandomValues(bytes); return bytes; };
export { randomUUID };
export default { randomUUID, randomBytes };
