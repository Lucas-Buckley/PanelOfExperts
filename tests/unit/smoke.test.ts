import { describe, expect, it } from "vitest";

import { smokeCheck } from "../../src/lib/smoke";

describe("smoke check", () => {
  it("returns ok", () => {
    expect(smokeCheck()).toBe("ok");
  });
});
