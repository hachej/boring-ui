import type { Harness } from '@earendil-works/pi-durable';
import type { AttachmentInput, BorrowedAttachment } from './contracts.js';

/** Passive borrowing acquires no observer, storage or execution lifetime. */
export function attachHarness<NativeHarness extends Harness>(input: AttachmentInput<NativeHarness>): BorrowedAttachment<NativeHarness> {
  return { harness: input.harness, detach: async () => {} };
}
