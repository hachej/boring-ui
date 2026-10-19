// Where an embedded page puts its own header controls when a host header already exists. The app shell (`app-shell`) provides the
// element of its screen header to the screen on show; `AgentWorkspace layout="embedded"` (`pi-app`) renders its bar's controls there
// (a React portal), so the page has one header row. Null outside a shell screen on show: the page keeps its own bar. Host concern: Pi has
// no layout. It lives here because both items depend on `utils` and neither imports the other.
import { createContext, useContext } from 'react';

export const ScreenHeaderSlotContext = createContext<HTMLElement | null>(null);

/** The host header's slot for the calling screen's controls, or null when there is none. */
export const useScreenHeaderSlot = (): HTMLElement | null => useContext(ScreenHeaderSlotContext);
