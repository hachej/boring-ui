// The feedback scenario for Ledgerly, read by scripts/feedback-scenario.mjs (see docs/implementation/FEEDBACK-SCENARIO.md).
// Selectors are CSS selectors evaluated in the page. Every value here is fictional.
export default {
  // A path on the app's origin, or a full URL. The ids, query and fragment are deliberately sensitive: only the template may leave.
  url: '/books/brightwater-5521/accounts/acct-90817?holder=Ilsa%20Brandvold#iban=LD91%200042%208800%201273%206655%2003',
  // What to point at; the label must be readable (not "masked"), clicking it must pin without pressing it.
  point: '[data-testid="save-entry"]',
  // An element in a masked data region: its label must say "masked".
  masked: '[data-testid="accounts"] tbody tr:first-child td',
  expect: {
    // A string must match exactly; a RegExp lets the line number move.
    fallback: /^the «Save entry» button \(SaveBar\.jsx:\d+\)$/,
    // A prefix of signals.source (data-source); the line may move.
    source: 'src/ledger/SaveBar.jsx:',
    route: '/books/:bookId/accounts/:accountId',
    // The overlay label while pointing.
    label: 'SaveBar · button «Save entry»',
  },
  // Must never appear (nor their HTML-entity, percent-encoded or compacted forms) in the report, labels or any captured output.
  sensitive: [
    'Marguerite Okonkwo-Fairbanks', "Teodor O'Hara & Søn", 'Ilsa Brandvold',
    'LD42 7731 0099 6610 2210 58', 'LD07 5520 1180 3344 9000 12', 'LD91 0042 8800 1273 6655 03',
    '48,213.07', '9,870.55', '312.40', '1,250.00',
    'brightwater-5521', 'acct-90817',
  ],
  // Identical elements without identity: pin the first, Show must offer numbered candidates instead of guessing.
  duplicate: '[data-testid="exports"] button',
};
