// An options module ends with `satisfies HostOptions`: the generated server.ts spreads it, so only this catches a misspelt key.
import type { HostOptions } from '@hachej/boring-agent/host';

export const right = { worker: { name: 'app' }, signUp: false } satisfies HostOptions;

// @ts-expect-error `signup` is not `signUp`
export const misspelt = { worker: { name: 'app' }, signup: false } satisfies HostOptions;
