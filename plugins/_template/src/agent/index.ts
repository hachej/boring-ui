export default function samplePiExtension(api: { registerTool(tool: unknown): void }) {
  api.registerTool({
    name: "sample_lookup",
    label: "Sample lookup",
    description: "Return sample plugin data.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute() {
      return { content: [{ type: "text", text: "sample data" }] }
    },
  })
}
