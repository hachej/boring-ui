// Variant `team`: ONE agent on the studio's one harness, used by several fictional people, each in their own workspace. Nothing about
// the agent is per person: its file guard, `present`, canvas tools, bash, working_git and self-evolution take the workspace of each
// call from the env Pi resolved for it (`@hachej/boring-agent/workspaces`: the cache attaches each person's workspace to that person's env),
// from the person who owns the conversation. The viewers (file tree, file viewer, uploads, resources, Git tab, `/reload`) resolve the
// same workspace from the authenticated request. Workspaces open on first use and close when idle.
//
// Where the files live: one SQLite file in the data directory, one workspace (file system + journal) per person in it, with just-bash
// over the same rows, like the Cloudflare recipe. Each person's workspace is also their own git repository (isomorphic-git over the
// same file system, `createEnvGitFs`), and holds their agent's own `.agent/` (self-evolution: the extension `self-evolving:team-<person>`,
// selected only by that person's conversations). The harbour MCP server is reached with each person's own fictional credential.
import { join } from 'node:path';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { createEnvGitFs, createGitRepository } from '@hachej/boring-files/git';
import { createVirtualWorkspace } from '@hachej/boring-execution/virtual';
import { fictionalHarbourServer } from '../fixtures/mcp-server.mjs';
import { gitRoutes } from './_git-routes.mjs';

const ROOT = '/workspace';
const README = '# Fictional team workspace\n\nEverything here is invented demo content. Only you and your agent see the files in it.\n';

export default host => ({
  id: 'team', title: 'Team', order: 20,
  description: 'One agent for several people: each person has their own workspace, repository, agent-written tools and connected services, resolved per call like the environment.',
  available: true,
  capabilities: ['workspace', 'shell', 'git'],
  // The agent may write its own instructions, skills and tools in `.agent/` of the person's workspace; each person's stay theirs.
  selfEvolving: true,
  // Every person's calls reach the harbour with that person's credential (the studio's fictional vault, `credentials` in server.mjs).
  mcp: { servers: [{ id: 'harbour', allow: ['tide_times', 'book_mooring'], readOnly: ['tide_times'], perPerson: true, transport: credential => fictionalHarbourServer({ credential }).transport }] },
  async open() {
    const connection = openNodeConnection(join(host.directory, 'team-workspaces.sqlite'), host.sqlite);
    const journal = createWorkspaceJournal(connection);
    return {
      root: ROOT,
      /** Idle workspaces close after this long (STUDIO_TEAM_IDLE_MS; the journey shortens it). */
      idleMs: Number(process.env.STUDIO_TEAM_IDLE_MS ?? 10 * 60_000),
      /**
       * Open one person's workspace: their files (rows of `workspace = <person>`), one provider over them, just-bash and their git
       * repository over the same file system. The provider's identity names the person, so receipts and history never mix between people.
       */
      async workspace(person, context) {
        const fs = openSqliteFileSystem({ connection, workspace: person, cwd: ROOT });
        const files = createWorkspaceProvider({ identity: { providerId: 'workspace', instanceId: `team-${person}`, incarnation: fs.incarnation, viewId: 'published' }, fs, journal });
        const repository = createGitRepository({ fs: createEnvGitFs(fs, context), directory: ROOT, author: { name: 'Fictional Agent', email: 'agent@example.invalid' }, authorize: () => true });
        if (!(await fs.exists(`${ROOT}/README.md`, context)).value) {
          await fs.writeFile(`${ROOT}/README.md`, README, context);
          await repository.init(); await repository.add('README.md'); await repository.commit('Initial commit');
        }
        const shell = createVirtualWorkspace({ providerId: 'studio-team', fs });
        const lease = await shell.acquire({ operationId: `team-${person}`, input: { cwd: ROOT } }, context);
        return { id: `team-${person}`, files, root: ROOT, env: lease.environment, repository,
          routes: gitRoutes({ repository, env: fs, root: ROOT, context }),
          close: async () => { await lease.release(context); shell.dispose(); } };
      },
      close: async () => { connection.close(); },
    };
  },
});
