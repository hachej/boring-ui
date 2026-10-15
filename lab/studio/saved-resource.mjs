// Cards for the canvas the agent changes through the canvas tools (`present` carries its own descriptor; Pi's file tools make no card).
// The board is a file at its path: a saved change maps to a descriptor of that file at the revision the save produced, like a presented file.
const documentTools = variant => [
  ...(variant.capabilities.includes('canvas') ? [{ tools: ['add_canvas_shapes', 'remove_canvas_shapes'], type: 'canvas', mediaType: 'application/vnd.tldraw+json', target: variant.canvas }] : []),
];
export function savedResource(variant) {
  const specs = documentTools(variant);
  const revisionOf = result => {
    if (result.isError) return undefined;
    try {
      const value = JSON.parse(result.content.map(part => part.type === 'text' ? part.text : '').join(''));
      return value?.kind === 'saved' ? value.revision : undefined;
    } catch { return undefined; }
  };
  return (call, result) => {
    const spec = specs.find(candidate => candidate.tools.includes(call.name));
    const revision = spec && revisionOf(result);
    const path = spec?.target.resource.path;
    return revision ? { schema: 'boring.artifact', version: 1, title: path.slice(path.lastIndexOf('/') + 1), type: spec.type, mediaType: spec.mediaType, target: spec.target, revision } : undefined;
  };
}
