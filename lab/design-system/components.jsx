// Section 6: components. Every export of the kit's shadcn/ui files is rendered by its real component (the coverage tests check each demo for the
// component's own data-slot output): variants and sizes come from the components' cva blocks (data.js), overlays are open in bounded boxes.
import { ChatDemos } from './demos-chat.jsx';
import { ControlDemos } from './demos-controls.jsx';
import { LayoutDemos } from './demos-layout.jsx';
import { OverlayDemos } from './demos-overlays.jsx';
import { SidebarDemo, ToastDemo } from './demos-shell.jsx';

export function Components() {
  return (
    <section data-ds-section="components" className="flex flex-col gap-8">
      <h2 className="text-xl font-semibold">Components</h2>
      <ControlDemos />
      <LayoutDemos />
      <ChatDemos />
      <OverlayDemos />
      <SidebarDemo />
      <ToastDemo />
    </section>
  );
}
