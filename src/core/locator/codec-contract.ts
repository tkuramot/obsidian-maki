/**
 * Shared contract suite for the `LocatorCodec` type (design §11): every codec
 * value must satisfy the same round-trip property over the persisted format,
 * `decode(encode(x)) === x`. Imported by each codec's test file — this file
 * itself is a helper, not a test.
 */

import { describe, expect, it } from "vitest";
import type { Locator } from "../types";
import type { LocatorCodec } from "./codec";

export function describeCodecContract(
  name: string,
  codec: LocatorCodec,
  samples: readonly Locator[],
): void {
  describe(`${name} (LocatorCodec contract)`, () => {
    it.each(samples.map((loc) => [loc]))("round-trips %j", (loc) => {
      expect(codec.decode(codec.encode(loc))).toEqual(loc);
    });

    it("decodes empty params to null instead of throwing", () => {
      expect(codec.decode({})).toBeNull();
    });

    it("ignores unrelated params (e.g. color) when decoding", () => {
      for (const loc of samples) {
        const params = { ...codec.encode(loc), color: "yellow" };
        expect(codec.decode(params)).toEqual(loc);
      }
    });
  });
}
