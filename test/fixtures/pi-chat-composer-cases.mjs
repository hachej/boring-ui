// Fictional Composer prop sets: the golden markup in pi-chat-composer-baseline.json was rendered from these with the composer of
// main before the optional Feedback button (registry/pi-chat/composer.tsx at 7a813e8, the public main). test/contracts/feedback-composer.test.mjs
// renders them again with today's composer and no `feedback` prop and requires byte-identical markup.
// Owner-reference refresh: card cases cover the two-row default; older layouts require explicit props.
// Regenerated once for the token scale (feat/kit-shadcn-scale): only class tokens changed (sm:text-[0.9375rem] to sm:text-sm, the round
// controls' rounded-full to the --radius tiers rounded-lg/rounded-md).
// Regenerated for the impeccable design pass: only class attributes changed (compact pointer tools, 44px touch targets,
// quieter frame and focus ring). The update verified byte-identical markup after removing class attributes.
// Group 1 refresh: consumer-owned Base UI Buttons intentionally change markup and attributes. Approved against the
// stock/brand browser matrix; regenerate with scripts/update-composer-baseline.mjs. shadcn-controls.test.mjs covers behavior.
export const composerCases = () => {
  const noop = () => {};
  const base = { text: '', onText: noop, attachments: [], onRemoveAttachment: noop, working: false, sendBlocked: false, disabled: false, stopRequested: false,
    onSend: noop, onStop: noop, uploading: false, canAttach: true, fileAccept: 'image/*', onPickFiles: noop, textareaRef: { current: null } };
  return {
    'card-empty': base,
    'card-text': { ...base, text: 'A fictional document request' },
    'pill-empty': { ...base, layout: 'pill' },
    'pill-text': { ...base, layout: 'pill', text: 'A fictional document request' },
    'stacked-empty': { ...base, layout: 'stacked' },
    'stacked-text': { ...base, layout: 'stacked', text: 'Hello @notes/plan.md', mentionPaths: ['notes/plan.md'] },
    'stacked-working': { ...base, layout: 'stacked', text: 'next', working: true },
    'stacked-attachments': { ...base, layout: 'stacked', attachments: [{ id: 'a1', name: 'shot.png', mimeType: 'image/png', data: 'iVBORw0KGgo=' }], uploads: [{ id: 'u1', name: 'big.pdf', state: 'failed', error: 'too large' }] },
    'stacked-no-attach': { ...base, layout: 'stacked', canAttach: false, disabled: true, placeholder: 'Ask' },
    'inline-empty': { ...base, layout: 'inline' },
    'inline-working': { ...base, layout: 'inline', text: 'queued', working: true, uploading: true },
  };
};
