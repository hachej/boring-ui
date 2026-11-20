'use client';

// `composer` as a function of the viewport and the route: the object it gives, read again on a resize and on a route change. Kept apart from `composer-config.ts`, which has no React in it.
import { useEffect, useState } from 'react';
import { usePhone } from '../utils/use-media';
import type { AgentComposer } from './layer-context';
import type { ComposerConfig, ComposerInput } from './composer-config';

/** The string or object as given, or what the function gives for this viewport and route. */
export function useComposerInput(input: ComposerInput | undefined, route?: string): AgentComposer | ComposerConfig | undefined {
  const phone = usePhone();
  const [width, setWidth] = useState(() => typeof window === 'undefined' ? 0 : window.innerWidth);
  const dynamic = typeof input === 'function';
  useEffect(() => {
    if (!dynamic) return;
    const read = () => setWidth(window.innerWidth);
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, [dynamic]);
  return typeof input === 'function' ? input({ phone, width, route }) : input;
}
