// The route as it may leave the page: the application's template, or the path with every segment masked. Never query or fragment.
import { maskText, type PrivacyPolicy, type RouteLocation } from './policy.js';

const pathOnly = (value: string): string => value.split(/[?#]/, 1)[0] ?? '';

/** Each non-empty path segment becomes `*` of equal length; separators are kept. */
export function maskedPath(pathname: string): string {
  return pathOnly(pathname).split('/').map(segment => maskText(segment)).join('/');
}

/** `routeOf(location)` when the policy has one and it returns a string, cut before any `?` or `#`; otherwise the masked path. */
export function routeFor(location: RouteLocation, policy: PrivacyPolicy): string {
  const pathname = String(location.pathname ?? '');
  if (policy.routeOf) {
    try {
      const template = policy.routeOf({ pathname, search: '', hash: '' });
      if (typeof template === 'string') return pathOnly(template);
    } catch { /* fall back to the masked path */ }
  }
  return maskedPath(pathname);
}
