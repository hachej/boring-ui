// Fictional Composer prop sets: the golden markup in pi-chat-composer-baseline.json was rendered from these with the composer of
// main before the optional Feedback button (registry/pi-chat/composer.tsx at 7a813e8, the public main). test/contracts/feedback-composer.test.mjs
// renders them again with today's composer and no `feedback` prop and requires byte-identical markup.
export const composerCases = () => {
  const noop = () => {};
  const base = { text: '', onText: noop, attachments: [], onRemoveAttachment: noop, working: false, sendBlocked: false, disabled: false, stopRequested: false,
    onSend: noop, onStop: noop, uploading: false, canAttach: true, fileAccept: 'image/*', onPickFiles: noop, textareaRef: { current: null } };
  return {
    'stacked-empty': base,
    'stacked-text': { ...base, text: 'Hello @notes/plan.md', mentionPaths: ['notes/plan.md'] },
    'stacked-working': { ...base, text: 'next', working: true },
    'stacked-attachments': { ...base, attachments: [{ id: 'a1', name: 'shot.png', mimeType: 'image/png', data: 'iVBORw0KGgo=' }], uploads: [{ id: 'u1', name: 'big.pdf', state: 'failed', error: 'too large' }] },
    'stacked-no-attach': { ...base, canAttach: false, disabled: true, placeholder: 'Ask' },
    'inline-empty': { ...base, layout: 'inline' },
    'inline-working': { ...base, layout: 'inline', text: 'queued', working: true, uploading: true },
  };
};
