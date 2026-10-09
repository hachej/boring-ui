import { layoutProps } from './experience-catalog.js';
import type { ExperienceDescriptor } from './experience-compose.js';

export function experienceRegion(descriptor: ExperienceDescriptor, name: string) {
  const path: string[] = [];
  const find = (id: string): boolean => {
    const node = descriptor.elements[id];
    if (!node) return false;
    path.push(id);
    if (node.type === 'boring/generated' && node.props.region === name) return true;
    for (const child of node.children) if (find(child)) return true;
    path.pop(); return false;
  };
  if (!find(descriptor.root)) throw new TypeError('Unknown generated region');
  const id = path.at(-1);
  const node = id === undefined ? undefined : descriptor.elements[id];
  if (!id || !node) throw new TypeError('Unknown generated region');
  const descendants = new Set<string>();
  const collect = (key: string): void => {
    descendants.add(key);
    for (const child of descriptor.elements[key]?.children ?? []) collect(child);
  };
  for (const child of node.children) collect(child);
  return { id, node, path, descendants, props: layoutProps['boring/generated'].parse(node.props) };
}

export function assertRegionReplacement(base: ExperienceDescriptor, next: ExperienceDescriptor, name: string): void {
  const region = experienceRegion(base, name), replacement = experienceRegion(next, name);
  const header = ({ elements: _elements, ...rest }: ExperienceDescriptor) => rest;
  if (region.id !== replacement.id || JSON.stringify(header(base)) !== JSON.stringify(header(next))) throw new TypeError('Region replacement changed the fixed layout');
  for (const [id, node] of Object.entries(base.elements)) {
    if (region.descendants.has(id)) continue;
    const candidate = next.elements[id];
    const before = id === region.id ? { ...node, children: [] } : node;
    const after = id === region.id && candidate ? { ...candidate, children: [] } : candidate;
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new TypeError('Region replacement changed a fixed element');
  }
  for (const id of Object.keys(next.elements)) if (!replacement.descendants.has(id) && !Object.hasOwn(base.elements, id)) throw new TypeError('Region replacement added a fixed element');
}
