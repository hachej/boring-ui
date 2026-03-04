const encodeSegment = (value) => encodeURIComponent(String(value || '').trim())

const normalizeWorkspaceSubpath = (subpath) =>
  String(subpath || '')
    .replace(/^\/+/, '')
    .trim()

export const routes = {
  approval: {
    pending: () => ({ path: '/api/approval/pending', query: undefined }),
    decision: () => ({ path: '/api/approval/decision', query: undefined }),
  },
  controlPlane: {
    auth: {
      login: (redirectUri) => ({
        path: '/auth/login',
        query: redirectUri ? { redirect_uri: redirectUri } : undefined,
      }),
      logout: () => ({ path: '/auth/logout', query: undefined }),
      settings: () => ({ path: '/auth/settings', query: undefined }),
    },
    me: {
      get: () => ({ path: '/api/v1/me', query: undefined }),
    },
    workspaces: {
      list: () => ({ path: '/api/v1/workspaces', query: undefined }),
      create: () => ({ path: '/api/v1/workspaces', query: undefined }),
      runtime: {
        get: (workspaceId) => ({
          path: `/api/v1/workspaces/${encodeSegment(workspaceId)}/runtime`,
          query: undefined,
        }),
        retry: (workspaceId) => ({
          path: `/api/v1/workspaces/${encodeSegment(workspaceId)}/runtime/retry`,
          query: undefined,
        }),
      },
      settings: {
        get: (workspaceId) => ({
          path: `/api/v1/workspaces/${encodeSegment(workspaceId)}/settings`,
          query: undefined,
        }),
        update: (workspaceId) => ({
          path: `/api/v1/workspaces/${encodeSegment(workspaceId)}/settings`,
          query: undefined,
        }),
      },
      setup: (workspaceId) => ({
        path: `/w/${encodeSegment(workspaceId)}/setup`,
        query: undefined,
      }),
      scope: (workspaceId, subpath = '') => {
        const normalizedSubpath = normalizeWorkspaceSubpath(subpath)
        return {
          path: normalizedSubpath
            ? `/w/${encodeSegment(workspaceId)}/${normalizedSubpath}`
            : `/w/${encodeSegment(workspaceId)}/`,
          query: undefined,
        }
      },
    },
  },
  project: {
    root: () => ({ path: '/api/project', query: undefined }),
  },
  capabilities: {
    get: () => ({ path: '/api/capabilities', query: undefined }),
  },
  config: {
    get: (configPath) => ({
      path: '/api/config',
      query: configPath ? { config_path: configPath } : undefined,
    }),
  },
  uiState: {
    upsert: () => ({ path: '/api/v1/ui/state', query: undefined }),
    list: () => ({ path: '/api/v1/ui/state', query: undefined }),
    latest: () => ({ path: '/api/v1/ui/state/latest', query: undefined }),
    get: (clientId) => ({ path: `/api/v1/ui/state/${encodeSegment(clientId)}`, query: undefined }),
    delete: (clientId) => ({ path: `/api/v1/ui/state/${encodeSegment(clientId)}`, query: undefined }),
    clear: () => ({ path: '/api/v1/ui/state', query: undefined }),
    panes: {
      latest: () => ({ path: '/api/v1/ui/panes', query: undefined }),
      get: (clientId) => ({ path: `/api/v1/ui/panes/${encodeSegment(clientId)}`, query: undefined }),
    },
    focus: () => ({ path: '/api/v1/ui/focus', query: undefined }),
    commands: {
      enqueue: () => ({ path: '/api/v1/ui/commands', query: undefined }),
      next: (clientId) => ({
        path: '/api/v1/ui/commands/next',
        query: clientId ? { client_id: clientId } : undefined,
      }),
    },
  },
  sessions: {
    list: () => ({ path: '/api/v1/agent/normal/sessions', query: undefined }),
    create: () => ({ path: '/api/v1/agent/normal/sessions', query: undefined }),
  },
  attachments: {
    upload: () => ({ path: '/api/v1/agent/normal/attachments', query: undefined }),
  },
  ws: {
    plugins: () => ({ path: '/ws/plugins', query: undefined }),
    pty: (query) => ({ path: '/ws/pty', query: query || undefined }),
    claudeStream: (query) => ({ path: '/ws/agent/normal/stream', query: query || undefined }),
  },
}
