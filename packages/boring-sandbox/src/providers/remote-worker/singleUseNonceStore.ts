export type SingleUseNonceResultV1 = "accepted" | "replay" | "exhausted";

interface NonceExpiryV1 {
  readonly nonce: string;
  readonly expiresAtMs: number;
}

/** Bounded single-threaded nonce set with O(log n) insertion/expiry eviction. */
export class SingleUseNonceStoreV1 {
  private readonly accepted = new Map<string, number>();
  private readonly expiries: NonceExpiryV1[] = [];

  constructor(private readonly maximum: number) {}

  consume(nonce: string, expiresAtMs: number, nowMs: number): SingleUseNonceResultV1 {
    this.evictExpired(nowMs);
    if (this.accepted.has(nonce)) return "replay";
    if (this.accepted.size >= this.maximum) return "exhausted";
    this.accepted.set(nonce, expiresAtMs);
    this.push({ nonce, expiresAtMs });
    return "accepted";
  }

  private evictExpired(nowMs: number): void {
    while (this.expiries[0]?.expiresAtMs <= nowMs) {
      const expired = this.pop();
      if (
        expired &&
        this.accepted.get(expired.nonce) === expired.expiresAtMs
      ) {
        this.accepted.delete(expired.nonce);
      }
    }
  }

  private push(value: NonceExpiryV1): void {
    let index = this.expiries.push(value) - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.expiries[parent]!.expiresAtMs <= value.expiresAtMs) break;
      this.expiries[index] = this.expiries[parent]!;
      index = parent;
    }
    this.expiries[index] = value;
  }

  private pop(): NonceExpiryV1 | undefined {
    const root = this.expiries[0];
    const tail = this.expiries.pop();
    if (!root || !tail || this.expiries.length === 0) return root;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.expiries.length) break;
      const right = left + 1;
      const child =
        right < this.expiries.length &&
        this.expiries[right]!.expiresAtMs < this.expiries[left]!.expiresAtMs
          ? right
          : left;
      if (this.expiries[child]!.expiresAtMs >= tail.expiresAtMs) break;
      this.expiries[index] = this.expiries[child]!;
      index = child;
    }
    this.expiries[index] = tail;
    return root;
  }
}
