import { openFeedbackWorkspace } from '../../examples/feedback/workspace.mjs';

/**
 * The SQLite workspace of the feedback example (one file per report, receipts in the same database) as one object: the workspace
 * provider's `read`, `publication`, `reconciliation` and `capabilities`, plus `listFolder`, `env` and `close`. Fictional data only.
 */
export async function openWorkspaceResources(filename, providerId, scopeId = 'fictional-project') {
  const workspace = await openFeedbackWorkspace({ filename, providerId, scopeId });
  return { ...workspace.files, listFolder: workspace.listFolder, env: workspace.env, root: workspace.root, files: workspace.files, close: workspace.close };
}
