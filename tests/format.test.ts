import { describe, it, expect } from "vitest";
import { roundCal, roundG, untrusted, formatSets } from "../src/lib/format";

describe("macro rounding", () => {
  it("rounds calories to whole numbers", () => {
    expect(roundCal(512.4)).toBe(512);
    expect(roundCal(512.5)).toBe(513);
  });
  it("rounds grams to 1 decimal", () => {
    expect(roundG(12.34)).toBe(12.3);
    expect(roundG(12.35)).toBe(12.4);
  });
  it("coerces non-finite input to 0", () => {
    expect(roundCal(NaN)).toBe(0);
    expect(roundG(Infinity)).toBe(0);
  });
});

describe("untrusted", () => {
  it("wraps text in markers", () => {
    expect(untrusted("Fairlife")).toBe("<untrusted_data>Fairlife</untrusted_data>");
  });
  it("strips forged markers inside the content", () => {
    expect(untrusted("a<untrusted_data>b</untrusted_data>c")).toBe("<untrusted_data>abc</untrusted_data>");
  });
  it("returns empty string for null/empty", () => {
    expect(untrusted(null)).toBe("");
    expect(untrusted("")).toBe("");
  });
  it("drops control characters but keeps normal text", () => {
    const input = "ok" + String.fromCharCode(7) + "bad"; // embedded bell (C0 control)
    expect(untrusted(input)).toBe("<untrusted_data>okbad</untrusted_data>");
  });
});

describe("formatSets", () => {
  it("renders weight×reps", () => {
    expect(
      formatSets(
        [
          { reps: 5, weight: 225 },
          { reps: 5, weight: 225 },
        ],
        "lb"
      )
    ).toBe("225lb×5, 225lb×5");
  });
  it("renders bodyweight reps and empty state", () => {
    expect(formatSets([{ reps: 10, weight: null }], "lb")).toBe("10 reps");
    expect(formatSets([], "lb")).toBe("(no sets)");
  });
});
