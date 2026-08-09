import { describe, expect, it } from "vitest";
import { isBatchReservationComplete } from "./creditPolicy";

describe("batch credit settlement", () => {
  it("does not settle after the first result in a multi-asset generation", () => {
    expect(isBatchReservationComplete(1, 4)).toBe(false);
  });

  it("settles when every accepted provider job has linked its run", () => {
    expect(isBatchReservationComplete(4, 4)).toBe(true);
  });

  it("rejects an invalid zero-sized batch", () => {
    expect(isBatchReservationComplete(0, 0)).toBe(false);
  });
});
