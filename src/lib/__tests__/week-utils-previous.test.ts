import { describe, it, expect } from "vitest";
import {
  getPreviousIsoWeek,
  getCurrentIsoWeek,
  toWeekKey,
} from "@/lib/week-utils";

describe("getPreviousIsoWeek", () => {
  it("returns the ISO week before the given date", () => {
    const date = new Date("2026-08-30T00:00:00Z"); // Sunday of WK-35
    const previous = getPreviousIsoWeek(date);
    expect(previous.year).toBe(2026);
    expect(previous.weekNumber).toBe(34);
    expect(toWeekKey(previous.weekNumber)).toBe("WK-34");
  });

  it("defaults to the previous ISO week of today", () => {
    const previous = getPreviousIsoWeek();
    const current = getCurrentIsoWeek();
    expect(previous.weekNumber).not.toBe(current.weekNumber);
  });
});
