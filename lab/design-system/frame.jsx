import { useEffect } from 'react';
import { Colors } from './colors.jsx';
import { Components } from './components.jsx';
import { Density, Shape, Type } from './look.jsx';
import { report } from './state.js';

export function Frame() {
  useEffect(report, []);
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 bg-background p-4 text-foreground" data-ds-frame-root>
      <Colors />
      <Type />
      <Shape />
      <Density />
      <Components />
    </main>
  );
}
