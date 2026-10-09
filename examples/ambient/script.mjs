// The scripted model's side of the ambient journey (see ../studio/scripted-model.mjs for the format): what the model answers to each
// prompt the journey sends, so the bar's behaviour (working status, queue and steer, toasts, artifacts, questions) runs the same way every
// time without a key. Used with STUDIO_MODEL=scripted. Fictional content only.
const call = (name, args, extra = {}) => ({ ...extra, tools: [{ name, args }] });

const POLICY_PATH = 'policies/password-rotation.md';
const POLICY = `# Password rotation policy

Staff rotate their console passwords every ninety days. A reminder is sent two weeks before the date.

Service accounts rotate on the first Tuesday of each quarter. The owner of a service account confirms the change in the console.
`;

export const AMBIENT_SOURCES = [{ name: 'ambient', entries: Object.entries({
  // The model takes a moment before the tool, as a real one does, so the working status is visible.
  'Run the health check': [call('run_health_check', { seconds: 14 }, { delay: 1500 }), '- **API:** latency 82 ms, ok.\n- **Queue:** nothing pending, last export Tuesday.'],
  // A background task the host app starts on its own.
  'Nightly export check': [call('run_health_check', { seconds: 8 }, { delay: 500 }), 'Everything is fine: the nightly export ran and nothing is pending.'],
  // Steered into the running turn: it is the last message when the model answers next.
  'BLUEBIRD': ['- **API:** latency 82 ms, ok.\n- **Queue:** nothing pending. BLUEBIRD'],
  // Read first (an error while nothing is saved), then write and present: a second request in the same workspace replaces the file the agent has read.
  'password rotation policy': [call('read', { path: POLICY_PATH }, { delay: 1500 }), call('write', { path: POLICY_PATH, content: POLICY }), call('present', { path: POLICY_PATH }), 'The policy is ready.'],
  'I need to deploy': [call('ask_user', { question: 'Which environment should I deploy to?', options: ['staging', 'production', 'canary'] }), ctx => `You chose ${ctx.last.json.answer}; I will deploy there.`],
  'exactly three words': ['Three words here.'],
  'exactly two words': ['Two words.'],
  'exactly four words': ['Four words right here.'],
}).map(([match, turns]) => ({ match, turns })) }];
