import { describe, expect, test } from "vitest";

import { SingleUseNonceStoreV1 } from "../singleUseNonceStore";

describe("single-use capability nonce store", () => {
  test("rejects replay and releases capacity at expiry", () => {
    const store = new SingleUseNonceStoreV1(1);
    expect(store.consume("nonce-a", 200, 100)).toBe("accepted");
    expect(store.consume("nonce-a", 200, 100)).toBe("replay");
    expect(store.consume("nonce-b", 300, 100)).toBe("exhausted");
    expect(store.consume("nonce-b", 300, 200)).toBe("accepted");
  });

  test("evicts out-of-order expiries without scanning live entries", () => {
    const store = new SingleUseNonceStoreV1(3);
    expect(store.consume("long", 1_000, 0)).toBe("accepted");
    expect(store.consume("short", 10, 0)).toBe("accepted");
    expect(store.consume("middle", 500, 0)).toBe("accepted");
    expect(store.consume("replacement", 600, 10)).toBe("accepted");
    expect(store.consume("long", 1_000, 10)).toBe("replay");
  });
});
