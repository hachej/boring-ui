import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import type { Extension } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';

/** Names of skills and agents: a lowercase letter or digit, then lowercase letters, digits, `.`, `_` or `-` (at most 64). */
export const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Instructions the agent loads on demand: only name and description occupy the system prompt. */
export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly body: string;
}

/** Parse a `SKILL.md`-style document: `---` front matter with `name` and `description`, then the body. */
export function parseSkill(markdown: string): Skill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown);
  if (!match) throw new TypeError('Skill needs front matter with name and description');
  const fields = new Map<string, string>();
  for (const line of match[1]!.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator > 0) fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, '$2'));
  }
  const name = fields.get('name'), description = fields.get('description');
  if (!name || !description) throw new TypeError('Skill front matter needs name and description');
  return validSkill({ name, description, body: match[2]!.trim() });
}

export function validSkill(skill: Skill): Skill {
  if (!NAME.test(skill.name)) throw new TypeError(`Invalid skill name: ${skill.name}`);
  if (!skill.description.trim() || !skill.body.trim()) throw new TypeError(`Skill ${skill.name} needs a description and a body`);
  return Object.freeze({ name: skill.name, description: skill.description.trim(), body: skill.body });
}

/** A prompt section listing the skills and a `load_skill` tool returning one body. Usable without `defineAgent`. */
export function createSkillsExtension(name: string, skills: readonly Skill[]): Extension {
  const known = new Map<string, Skill>();
  for (const skill of skills.map(validSkill)) {
    if (known.has(skill.name)) throw new TypeError(`Duplicate skill: ${skill.name}`);
    known.set(skill.name, skill);
  }
  const listing = [...known.values()].map(skill => `- ${skill.name}: ${skill.description}`).join('\n');
  return defineExtension({
    name,
    sections: [{ key: 'skills', render: () => `Before starting a task that matches a skill, call load_skill with its name and follow the returned instructions. A user message that starts with /<skill-name> naming one of these skills is an explicit request: call load_skill for that skill first and follow it for the rest of the message.\n${listing}` }],
    tools: [defineTool({
      name: 'load_skill',
      description: 'Load the full instructions of one listed skill.',
      parameters: Type.Object({ name: Type.String() }, { additionalProperties: false }),
      replay: 'safe',
      execute: async args => {
        const skill = known.get(args.name);
        return { content: [{ type: 'text', text: skill ? skill.body : `Unknown skill "${args.name}". Available: ${[...known.keys()].join(', ')}` }] };
      },
    })],
  });
}
