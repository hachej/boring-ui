// The same pinned HTTP/CLI isolation as the regular consumer, with the explicit optional item.
process.argv.push('--shared');
await import('./test-pi-chat-consumer.mjs');
