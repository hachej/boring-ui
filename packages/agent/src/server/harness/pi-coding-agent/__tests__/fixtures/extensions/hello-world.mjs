export default {
  name: "hello_world",
  description: "Synthetic hello-world extension for smoke tests.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string" },
    },
  },
  async execute(params) {
    const name =
      params && typeof params.name === "string" && params.name.length > 0
        ? params.name
        : "world";
    return {
      content: [{ type: "text", text: `Hello, ${name}! (from synthetic extension)` }],
    };
  },
};
