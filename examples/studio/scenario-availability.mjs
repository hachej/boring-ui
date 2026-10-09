// Whether a scenario can run on a variant, and why not in words. Plain module: the browser list and the journey runners both use it.
const WHAT = { workspace: 'a file browser', notes: 'a shared document', shell: 'a shell', git: 'git', sandbox: 'a remote sandbox', canvas: 'a canvas', subagents: 'subagents', codemode: 'code mode', mcp: 'MCP tools', 'self-evolving': 'self-evolution', python: 'Python', 'conversation-management': 'renaming, archiving, forking and deleting conversations' };

/** Why a scenario cannot run on `variant` (`{ id, title, capabilities }`), or `null` when it can. */
export function unavailableReason(scenario, variant, variants = [variant]) {
  if (scenario.variants && !scenario.variants.includes(variant.id)) {
    const titles = scenario.variants.map(id => variants.find(candidate => candidate.id === id)?.title ?? id);
    return `Runs on ${titles.join(' or ')} only.`;
  }
  const missing = (scenario.requires ?? []).filter(capability => !variant.capabilities.includes(capability));
  return missing.length ? `Needs ${missing.map(capability => WHAT[capability] ?? capability).join(' and ')}, which ${variant.title} does not offer.` : null;
}
