import type { ViewerController } from '@hachej/boring-ui-kit';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

/** Returning Promise to a void callback can silently discard it. Expose the
 * actual owner-teardown possibility rather than promising synchronous cleanup.
 */
export type AsyncTeardownIsVisible = Assert<Equal<ReturnType<ViewerController<{}, {}, {}>['dispose']>, void | Promise<void>>>;
export type UnsubscribeRemainsSynchronous = Assert<Equal<ReturnType<ReturnType<ViewerController<{}, {}, {}>['subscribe']>>, void>>;
