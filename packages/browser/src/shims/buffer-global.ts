// isomorphic-git expects Node's global `Buffer`; in a browser worker it is the `buffer` package's implementation.
import { Buffer } from 'buffer';
const scope = globalThis as { Buffer?: unknown };
scope.Buffer ??= Buffer;
