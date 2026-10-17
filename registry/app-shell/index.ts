// The app shell: layouts A (`screen`), B (`workspace`) and C (`chat`) with their navigation, header and account menu, and the AgentLayer it mounts.
export { AppShell } from './app-shell';
export type { AppShellProps } from './app-shell';
export { AccountMenu, NavUser } from './account';
export type { AccountSpec } from './account';
export { ListDetail, listDetailView } from './list-detail';
export type { ListDetailProps } from './list-detail';
export { AppSheet } from './app-sheet';
export { useShellLayer } from './shell-layer';
export type { ShellLayer } from './shell-layer';
export { AppSidebar, TabBar } from './nav';
export type { NavItem } from './nav';
export { ScreenHeader, useScreenHeader } from './header';
export type { ScreenHeaderSpec } from './header';
export { useIsCompact } from './compact';
export { AgentDockLayout, AgentLayer, AgentTrigger, useAgentLayer } from './agent-layer';
export { readAgentContext, useAgentContext } from './agent-context';
