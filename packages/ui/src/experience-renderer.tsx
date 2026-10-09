'use client';

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { defineRegistry, JSONUIProvider, Renderer } from '@json-render/react';
import { experienceCatalog } from './experience-catalog.js';
import type { ExperienceAccess, ExperienceCell, ExperienceDescriptor } from './experience-compose.js';

/** A cell the host can show: its access record plus how to render it. */
export interface RenderedExperienceCell extends ExperienceCell {
  readonly render: () => ReactNode;
}

interface LiveCells {
  readonly cells: readonly RenderedExperienceCell[];
  readonly canView: ExperienceAccess['canView'];
  readonly kinds: ExperienceDescriptor['kinds'];
}
const CellContext = createContext<LiveCells | null>(null);
const MinimumWidth = createContext(0);
const gaps = { small: '0.5rem', medium: '1rem', large: '1.5rem' };
const { registry } = defineRegistry(experienceCatalog, { components: {
  'boring/stack': ({ props, children }) => <div data-boring="experience-stack" style={{ display: 'flex', flexDirection: 'column', gap: gaps[props.gap] }}>{children}</div>,
  'boring/row': ({ props, children }) => <div data-boring="experience-row" style={{ display: 'flex', flexWrap: 'wrap', gap: gaps[props.gap] }}>{children}</div>,
  'boring/grid': ({ props, children }) => {
    const minimumWidth = useContext(MinimumWidth);
    return <div data-boring="experience-grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${props.columns}, minmax(${minimumWidth}px, 1fr))`, gap: gaps[props.gap] }}>{children}</div>;
  },
  'boring/cell': ({ props }) => {
    const live = useContext(CellContext);
    const matches = live?.cells.filter(cell => cell.ref === props.ref) ?? [];
    const cell = matches.length === 1 ? matches[0] : undefined;
    let permitted = false;
    try { permitted = !!cell && live?.kinds[cell.kind] === cell.version && live.canView(cell.ref) === true; } catch { permitted = false; }
    const minimumWidth = useContext(MinimumWidth);
    return <div data-boring="experience-cell" style={{ minWidth: minimumWidth, flexShrink: 0 }}>{permitted && cell ? <cell.render /> : <p role="status">Cell unavailable</p>}</div>;
  },
  'boring/generated': ({ props, children }) => {
    const minimumWidth = Math.max(useContext(MinimumWidth), props.minWidth);
    return <div data-boring="experience-region" data-region={props.region} style={{ overflowX: 'auto', minWidth: 0 }}>
      <MinimumWidth value={minimumWidth}>{children}</MinimumWidth>
    </div>;
  },
} });

export function ExperienceRenderer({ descriptor, cells, canView }: Omit<LiveCells, 'kinds'> & { readonly descriptor: ExperienceDescriptor }) {
  return <CellContext value={{ cells, canView, kinds: descriptor.kinds }}>
    <JSONUIProvider registry={registry}><Renderer spec={descriptor} registry={registry} /></JSONUIProvider>
  </CellContext>;
}
