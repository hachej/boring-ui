// Variant `cloudflare`: a separate deployment, not something this server hosts. examples/cloudflare runs the SAME standard agent
// (examples/shared/standard-agent.mjs) in a Durable Object on Workers, with the capabilities Workers can give it, and its
// journey runs the SAME scenario files against the deployed URL. The selector lists it so the choice is visible.
export default () => ({
  id: 'cloudflare', title: 'Cloudflare', order: 80,
  description: 'The same agent and scenarios in a Durable Object on Workers. A separate deployment: see examples/cloudflare/README.md.',
  available: { reason: 'Runs as its own deployment. See examples/cloudflare/README.md.' },
  capabilities: [],
  link: 'examples/cloudflare/README.md',
});
