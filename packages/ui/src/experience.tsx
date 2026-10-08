'use client';

import { useState } from 'react';
import { ExperienceRenderer } from './experience-renderer.js';
import type { RenderedExperienceCell } from './experience-renderer.js';
import { validateExperience } from './experience-compose.js';
import type { ExperienceAccess, ExperienceDescriptor } from './experience-compose.js';

export { ExperienceRenderer } from './experience-renderer.js';
export type { RenderedExperienceCell } from './experience-renderer.js';
export interface ExperienceProps {
  readonly descriptor: unknown;
  readonly cells: readonly RenderedExperienceCell[];
  readonly canView: ExperienceAccess['canView'];
  readonly className?: string;
}

type Selection = { readonly input: unknown; readonly kind: 'ready'; readonly descriptor: ExperienceDescriptor }
  | { readonly input: unknown; readonly kind: 'invalid' };
function select(props: ExperienceProps): Selection {
  try { return { input: props.descriptor, kind: 'ready', descriptor: validateExperience(props.descriptor, props) }; }
  catch { return { input: props.descriptor, kind: 'invalid' }; }
}

export function Experience(props: ExperienceProps) {
  const [current, setCurrent] = useState(() => select(props));
  const candidate = current.input === props.descriptor && current.kind === 'ready' ? null : select(props);
  const offered = candidate?.kind === 'invalid' && current.kind === 'invalid' ? null : candidate;
  return <section data-boring="experience" className={props.className} aria-label={current.kind === 'ready' ? current.descriptor.title ?? current.descriptor.name : 'Experience unavailable'}>
    {offered && (offered.kind === 'ready'
      ? <button type="button" onClick={() => setCurrent(offered)}>Use proposed layout</button>
      : <p role="alert">Proposed layout unavailable. The current layout has been retained.</p>)}
    {current.kind === 'invalid' ? <p role="alert">Experience unavailable</p>
      : <ExperienceRenderer descriptor={current.descriptor} cells={props.cells} canView={props.canView} />}
  </section>;
}
