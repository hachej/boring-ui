/** A channel failure's message and retryability come from the host, or from an unconfirmed transport failure. */
export class ChannelRequestError extends Error {
  readonly refused: boolean;
  constructor(readonly code: string, message: string, readonly retryable: boolean, options?: { readonly refused?: boolean }) {
    super(message); this.name = 'ChannelRequestError'; this.refused = options?.refused ?? false;
  }
}
