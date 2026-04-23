# with-custom-tool

Minimal example showing how to add a custom tool to `@boring/agent`.

## Intent

Demonstrate the shape of an `AgentTool` and how it is passed into the catalog/harness wiring.

## Example

```ts
import type { AgentTool } from '@boring/agent/shared'

const helloTool: AgentTool = {
  name: 'hello',
  description: 'Returns a greeting',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
    },
    required: ['name'],
  },
  async execute(input) {
    const name = String((input as { name: unknown }).name ?? 'world')
    return {
      content: [{ type: 'text', text: `Hello, ${name}!` }],
    }
  },
}

// Then include `helloTool` in your tool catalog setup.
```

## Notes

- Keep tool inputs strictly schema-validated.
- Prefer deterministic output contracts for UI rendering.
- Use shared interfaces from `@boring/agent/shared` for typing.
