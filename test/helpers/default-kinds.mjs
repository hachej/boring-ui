// The agent page as an app renders it: pi-app draws only the kinds it is passed, and an app passes the pi-app-kinds default list.
// `DEFAULT_KINDS_ENTRY` bundles the page and that list in one module graph; `withDefaultKinds` gives AgentWorkspace (artifactKinds),
// FileViewer and ArtifactPanel (options.kinds) the list unless a test passes its own.
export const DEFAULT_KINDS_ENTRY = {
  contents: "export * from './pi-app/agent-workspace.tsx';\nexport { defaultKinds } from './pi-app-kinds/pi-app-kinds.ts';\n",
  resolveDir: new URL('../../registry/', import.meta.url).pathname,
  loader: 'ts',
};

export function withDefaultKinds(page, createElement) {
  const kinds = page.defaultKinds();
  return {
    ...page,
    AgentWorkspace: props => createElement(page.AgentWorkspace, { artifactKinds: kinds, ...props }),
    FileViewer: props => createElement(page.FileViewer, { ...props, options: { kinds, ...props.options } }),
    ArtifactPanel: props => createElement(page.ArtifactPanel, { ...props, options: { kinds, ...props.options } }),
  };
}
