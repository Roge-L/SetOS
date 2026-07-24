import { describe, it, expect } from "vitest";
import {
  isValidDate,
  assertDate,
  shiftDate,
  dateRange,
  dateInTimezone,
  localWallToUTC,
  utcRangeForLocalDate,
} from "../src/lib/dates";

const NY = "America/New_York";

describe("isValidDate", () => {
  it("accepts real dates", () => {
    expect(isValidDate("2026-07-23")).toBe(true);
    expect(isValidDate("2026-02-29")).toBe(false); // 2026 is not a leap year
    expect(isValidDate("2024-02-29")).toBe(true);
  });
  it("rejects malformed / impossible dates", () => {
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("2026-07-40")).toBe(false);
    expect(isValidDate("7/23/2026")).toBe(false);
    expect(isValidDate("2026-7-3")).toBe(false);
  });
  it("assertDate throws on bad input", () => {
    expect(() => assertDate("nope")).toThrow();
    expect(assertDate("2026-07-23")).toBe("2026-07-23");
  });
});

describe("shiftDate", () => {
  it("adds and subtracts days across month boundaries", () => {
    expect(shiftDate("2026-07-31", 1)).toBe("2026-08-01");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("is unaffected by DST (anchored at noon UTC)", () => {
    // US spring-forward is 2026-03-08; stepping across it stays correct.
    expect(shiftDate("2026-03-07", 1)).toBe("2026-03-08");
    expect(shiftDate("2026-03-08", 1)).toBe("2026-03-09");
  });
});

describe("dateRange", () => {
  it("is inclusive of both ends", () => {
    expect(dateRange("2026-07-20", "2026-07-23")).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
    ]);
  });
  it("returns a single day when start === end", () => {
    expect(dateRange("2026-07-20", "2026-07-20")).toEqual(["2026-07-20"]);
  });
});

describe("timezone conversions (America/New_York)", () => {
  it("maps local midnight to the correct UTC instant in summer (EDT, UTC-4)", () => {
    expect(localWallToUTC("2026-07-15", 0, 0, 0, NY).toISOString()).toBe("2026-07-15T04:00:00.000Z");
  });
  it("maps local midnight to the correct UTC instant in winter (EST, UTC-5)", () => {
    expect(localWallToUTC("2026-01-15", 0, 0, 0, NY).toISOString()).toBe("2026-01-15T05:00:00.000Z");
  });
  it("assigns a late-night meal to the correct local day", () => {
    // 2026-07-15T03:59Z is 2026-07-14 23:59 in NY — still the 14th.
    expect(dateInTimezone(new Date("2026-07-15T03:59:00Z"), NY)).toBe("2026-07-14");
    // One minute later crosses local midnight → the 15th.
    expect(dateInTimezone(new Date("2026-07-15T04:00:00Z"), NY)).toBe("2026-07-15");
  });
});

describe("utcRangeForLocalDate", () => {
  it("covers exactly one local day as a half-open UTC range (summer)", () => {
    expect(utcRangeForLocalDate("2026-07-15", NY)).toEqual({
      start: "2026-07-15T04:00:00.000Z",
      end: "2026-07-16T04:00:00.000Z",
    });
  });
  it("handles the spring-forward day (23 hours long)", () => {
    // 2026-03-08: clocks jump 02:00→03:00 EST→EDT. The local day is 23h of UTC.
    const { start, end } = utcRangeForLocalDate("2026-03-08", NY);
    expect(start).toBe("2026-03-08T05:00:00.000Z");
    expect(end).toBe("2026-03-09T04:00:00.000Z");
  });
});
