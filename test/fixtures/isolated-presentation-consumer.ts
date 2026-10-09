import { Type } from '@earendil-works/pi-ai';
import type { ToolRegistration } from '@earendil-works/pi-durable';
import type { PresentationCommand } from '@hachej/boring-ui-kit/contracts';
import { createPresentationTool } from '@hachej/boring-agent/presentation';

declare const command: PresentationCommand<
  { readonly index: number; readonly expiresAt: number },
  { readonly privateText: string },
  { readonly documentId: string }
>;
const parameters = Type.Object({ index: Type.Integer({ minimum: 0 }) });
const options = {
  name: 'navigate_notes', description: 'Navigate the explicitly bound notes', parameters, command,
  target: { instanceId: 'notes', epoch: 'page-one', subject: { documentId: 'fictional' } },
  prepareInput: (args: { index: number }) => ({ index: args.index, expiresAt: Date.now() + 5000 }),
  authorize: () => true,
  formatResult: () => ({ content: [{ type: 'text' as const, text: 'applied' }] }),
};
const tool: ToolRegistration<typeof parameters> = createPresentationTool({
  ...options,
  authorize: (input, target, api, context) => {
    const index: number = input.index;
    const documentId: string = target.subject.documentId;
    return index >= 0 && documentId === 'fictional' && api.conversationId > 0 && !context.abortSignal?.aborted;
  },
  formatResult: result => {
    if (result.kind === 'unknown') {
      const reason: string = result.reason;
      return { content: [{ type: 'text', text: `Unconfirmed browser effect: ${reason}` }] };
    }
    if (result.kind === 'applied') {
      const privateText: string = result.value.privateText;
      return { content: [{ type: 'text', text: JSON.stringify({ kind: result.kind, length: privateText.length }) }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ kind: result.kind }) }] };
  },
});
void tool;

createPresentationTool({ ...options,
  // @ts-expect-error A different subject cannot replace this command's document identity.
  target: { instanceId: 'notes', epoch: 'page-one', subject: { documentId: 42 } },
});
createPresentationTool({ ...options,
  // @ts-expect-error Mapped input retains the command's concrete index type.
  prepareInput: () => ({ index: 'first', expiresAt: 123 }),
});
