const S = (properties, required = Object.keys(properties)) => ({
  type: "object", properties, required, additionalProperties: false,
});
const str = (description) => ({ type: "string", description });
const num = (description) => ({ type: "number", description });

function tool(name, description, parameters, implementation) {
  return {
    name, label: name, description, parameters,
    async execute(toolCallId, params) {
      const value = implementation(params);
      return {
        content: [{ type: "text", text: JSON.stringify(value) }],
        details: { tool: name, toolCallId, params, value },
      };
    },
  };
}

const specs = [
  ["alpha_ping", "Check whether the alpha service is reachable.", S({ message: str("Ping message") }), ({ message }) => ({ pong: message })],
  ["beta_add", "Add two numeric values with the beta arithmetic service.", S({ a: num("First addend"), b: num("Second addend") }), ({ a, b }) => ({ sum: a + b })],
  ["gamma_echo", "Echo text through the gamma service.", S({ text: str("Text to echo") }), ({ text }) => ({ echo: text })],
  ["weather_lookup", "Look up synthetic weather for a city.", S({ city: str("City name") }), ({ city }) => ({ city, celsius: 21 })],
  ["invoice_total", "Calculate a synthetic invoice total.", S({ subtotal: num("Subtotal"), taxRate: num("Tax rate") }), ({ subtotal, taxRate }) => ({ total: subtotal * (1 + taxRate) })],
  ["currency_convert", "Convert a synthetic currency amount.", S({ amount: num("Amount"), pair: str("Currency pair") }), ({ amount, pair }) => ({ amount, pair, converted: amount * 1.1 })],
  ["customer_lookup", "Find a synthetic customer record by email.", S({ email: str("Customer email") }), ({ email }) => ({ email, customerId: "cus_1042" })],
  ["order_status", "Read a synthetic order shipment status.", S({ orderId: str("Order identifier") }), ({ orderId }) => ({ orderId, status: "shipped" })],
  ["inventory_check", "Check synthetic inventory for a SKU.", S({ sku: str("Stock keeping unit") }), ({ sku }) => ({ sku, available: 17 })],
  ["shipping_quote", "Quote synthetic shipping between postal codes.", S({ from: str("Origin postal code"), to: str("Destination postal code") }), ({ from, to }) => ({ from, to, price: 12.5 })],
  ["calendar_slots", "List synthetic open calendar slots.", S({ date: str("ISO date") }), ({ date }) => ({ date, slots: ["09:00", "14:00"] })],
  ["meeting_schedule", "Schedule a synthetic meeting.", S({ title: str("Meeting title"), at: str("ISO timestamp") }), ({ title, at }) => ({ title, at, scheduled: true })],
  ["email_draft", "Draft a synthetic email message.", S({ to: str("Recipient"), subject: str("Subject") }), (p) => ({ ...p, draftId: "draft_12" })],
  ["document_search", "Search synthetic documents for a phrase.", S({ phrase: str("Search phrase") }), ({ phrase }) => ({ phrase, hits: 3 })],
  ["document_summarize", "Summarize synthetic document text.", S({ text: str("Document text") }), ({ text }) => ({ summary: text.slice(0, 24) })],
  ["translation_run", "Translate synthetic text into a language.", S({ text: str("Source text"), language: str("Target language") }), (p) => ({ ...p, translated: `[${p.language}] ${p.text}` })],
  ["sentiment_score", "Score synthetic text sentiment.", S({ text: str("Text to score") }), ({ text }) => ({ text, score: 0.7 })],
  ["image_metadata", "Read synthetic image metadata.", S({ url: str("Image URL") }), ({ url }) => ({ url, width: 800, height: 600 })],
  ["video_transcript", "Fetch a synthetic video transcript.", S({ videoId: str("Video identifier") }), ({ videoId }) => ({ videoId, transcript: "synthetic transcript" })],
  ["audio_duration", "Read synthetic audio duration.", S({ url: str("Audio URL") }), ({ url }) => ({ url, seconds: 42 })],
  ["repo_branches", "List synthetic repository branches.", S({ repo: str("Repository") }), ({ repo }) => ({ repo, branches: ["main", "dev"] })],
  ["commit_lookup", "Find a synthetic commit by SHA.", S({ sha: str("Commit SHA") }), ({ sha }) => ({ sha, author: "Ada" })],
  ["issue_create", "Create a synthetic issue.", S({ title: str("Issue title") }), ({ title }) => ({ title, issue: 1226 })],
  ["pull_request_merge", "Merge a synthetic pull request.", S({ number: num("Pull request number") }), ({ number }) => ({ number, merged: true })],
  ["build_status", "Read synthetic CI build status.", S({ buildId: str("Build identifier") }), ({ buildId }) => ({ buildId, status: "passed" })],
  ["deployment_promote", "Promote a synthetic deployment.", S({ environment: str("Target environment") }), ({ environment }) => ({ environment, promoted: true })],
  ["log_search", "Search synthetic application logs.", S({ query: str("Log query") }), ({ query }) => ({ query, matches: 8 })],
  ["metric_query", "Query a synthetic numeric metric.", S({ metric: str("Metric name") }), ({ metric }) => ({ metric, value: 99.9 })],
  ["alert_acknowledge", "Acknowledge a synthetic alert.", S({ alertId: str("Alert identifier") }), ({ alertId }) => ({ alertId, acknowledged: true })],
  ["feature_flag_read", "Read a synthetic feature flag.", S({ key: str("Flag key") }), ({ key }) => ({ key, enabled: false })],
  ["experiment_assign", "Assign a synthetic experiment variant.", S({ userId: str("User identifier") }), ({ userId }) => ({ userId, variant: "B" })],
  ["database_health", "Check synthetic database health.", S({ cluster: str("Cluster name") }), ({ cluster }) => ({ cluster, healthy: true })],
  ["cache_invalidate", "Invalidate a synthetic cache key.", S({ key: str("Cache key") }), ({ key }) => ({ key, invalidated: true })],
  ["queue_depth", "Read synthetic queue depth.", S({ queue: str("Queue name") }), ({ queue }) => ({ queue, depth: 6 })],
  ["secret_rotate", "Rotate a synthetic secret reference.", S({ secret: str("Secret name") }), ({ secret }) => ({ secret, version: 2 })],
  ["policy_evaluate", "Evaluate a synthetic policy subject.", S({ subject: str("Policy subject") }), ({ subject }) => ({ subject, allowed: true })],
  ["user_permissions", "List synthetic user permissions.", S({ userId: str("User identifier") }), ({ userId }) => ({ userId, permissions: ["read"] })],
  ["team_members", "List synthetic team members.", S({ team: str("Team name") }), ({ team }) => ({ team, count: 5 })],
  ["project_progress", "Read synthetic project completion percentage.", S({ project: str("Project name") }), ({ project }) => ({ project, percent: 68 })],
  ["risk_assess", "Assess synthetic project risk.", S({ project: str("Project name") }), ({ project }) => ({ project, risk: "medium" })],
];

export const catalogTools = specs.map((spec) => tool(...spec));
export const catalogMap = new Map(catalogTools.map((entry) => [entry.name, entry]));

export function signature(toolEntry) {
  return { name: toolEntry.name, description: toolEntry.description, parameters: toolEntry.parameters };
}

export function makeCallTool(map = catalogMap) {
  const dispatcher = tool(
    "call_tool",
    "Invoke an installed host-side catalog tool by exact name and arguments.",
    S({ name: str("Exact catalog tool name"), args: { type: "object", description: "Arguments for the target tool", additionalProperties: true } }),
    () => null,
  );
  return {
    ...dispatcher,
    async execute(outerCallId, { name, args }, signal, onUpdate) {
      const target = map.get(name);
      if (!target) throw new Error(`unknown catalog tool: ${name}`);
      const innerCallId = `${outerCallId}:child:${name}`;
      const inner = await target.execute(innerCallId, args, signal, onUpdate);
      return {
        content: inner.content,
        details: { dispatchedName: name, innerCallId, innerResult: inner },
      };
    },
  };
}

export function makeSearchTools(map = catalogMap, resultBudgetBytes = 8000) {
  const searcher = tool(
    "search_tools",
    "Search the host-side tool catalog. Returns matching non-resident tool signatures.",
    S({ query: str("Words describing the capability or exact tool name") }),
    () => null,
  );
  return {
    ...searcher,
    async execute(toolCallId, { query }) {
      const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const ranked = [...map.values()].map((entry) => {
        const haystack = `${entry.name} ${entry.description}`.toLowerCase();
        return { entry, score: terms.reduce((n, term) => n + (haystack.includes(term) ? 1 : 0), 0) };
      }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
      const matches = (ranked.length ? ranked : [...map.values()].map((entry) => ({ entry })))
        .slice(0, 8).map(({ entry }) => signature(entry));
      while (Buffer.byteLength(JSON.stringify(matches)) > resultBudgetBytes && matches.length > 1) matches.pop();
      return {
        content: [{ type: "text", text: JSON.stringify({ matches }) }],
        details: { query, matchNames: matches.map(({ name }) => name), resultBudgetBytes },
      };
    },
  };
}

export const summaryCatalog = catalogTools.map((entry) => `${entry.name}: ${entry.description}`).join("\n");
