// The app shell: layout A (`screen`) with its navigation, header and account menu, and the AgentLayer it mounts.
export { AppShell } from './app-shell';
export type { AppShellProps } from './app-shell';
export { AccountMenu, NavUser } from './account';
export type { AccountSpec } from './account';
export { AppSheet } from './sheet';
export { AppSidebar, TabBar } from './nav';
export type { NavItem } from './nav';
export { ScreenHeader, useScreenHeader } from './header';
export type { ScreenHeaderSpec } from './header';
export { useIsCompact } from './compact';
export { AgentLayer, AgentTrigger, useAgentLayer } from './agent-layer';
export { readAgentContext, useAgentContext } from './agent-context';
