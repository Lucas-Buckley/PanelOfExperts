import { describe, expect, it } from "vitest";

import { formatTimestamp, sortConversation } from "../../src/app/pageHelpers";

describe("page helpers", () => {
  it("sorts prompts and responses by sequence with id tie-breakers", () => {
    const sorted = sortConversation({
      prompts: [
        {
          id: 10,
          sequence: 2,
          responses: [
            { id: 4, sequence: 2 },
            { id: 3, sequence: 1 },
            { id: 2, sequence: 2 }
          ]
        },
        {
          id: 9,
          sequence: 1,
          responses: [
            { id: 11, sequence: 1 },
            { id: 10, sequence: 1 }
          ]
        }
      ]
    });

    expect(sorted.prompts.map((prompt) => prompt.id)).toEqual([9, 10]);
    expect(sorted.prompts[0]?.responses.map((response) => response.id)).toEqual([10, 11]);
    expect(sorted.prompts[1]?.responses.map((response) => response.id)).toEqual([3, 2, 4]);
  });

  it("formats null timestamps as N/A", () => {
    expect(formatTimestamp(null)).toBe("N/A");
  });

  it("returns raw value when timestamp is invalid", () => {
    expect(formatTimestamp("not-a-date")).toBe("not-a-date");
  });
});
