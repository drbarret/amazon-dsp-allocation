import { describe, it, expect } from "vitest";
import {
  getCurrentIsoWeek,
  getNextIsoWeek,
  toWeekKey,
} from "@/lib/week-utils";

describe("week-utils", () => {
  describe("getCurrentIsoWeek", () => {
    it("returns ISO week 35 of 2026 for 2026-08-26 (Wednesday)", () => {
      const result = getCurrentIsoWeek(new Date("2026-08-26T12:00:00Z"));
      expect(result.year).toBe(2026);
      expect(result.weekNumber).toBe(35);
      expect(result.startDate.toISOString().startsWith("2026-08-24")).toBe(true);
      expect(result.endDate.toISOString().startsWith("2026-08-30")).toBe(true);
    });

    it("handles week 53 across year boundary (2015-12-31)", () => {
      const result = getCurrentIsoWeek(new Date("2015-12-31T12:00:00Z"));
      expect(result.year).toBe(2015);
      expect(result.weekNumber).toBe(53);
    });

    it("assigns early January to the previous ISO year when Jan 1 falls on Fri/Sat/Sun", () => {
      // 2027-01-01 is Friday, so Jan 1-3 belong to ISO week 53 of 2026.
      const result = getCurrentIsoWeek(new Date("2027-01-02T12:00:00Z"));
      expect(result.year).toBe(2026);
      expect(result.weekNumber).toBe(53);
    });

    it("handles leap year without shifting ISO boundaries", () => {
      const result = getCurrentIsoWeek(new Date("2024-02-29T12:00:00Z"));
      expect(result.year).toBe(2024);
      expect(result.weekNumber).toBe(9);
      expect(result.startDate.toISOString().startsWith("2024-02-26")).toBe(true);
    });
  });

  describe("getNextIsoWeek", () => {
    it("returns week 36 when current is week 35", () => {
      const result = getNextIsoWeek(new Date("2026-08-26T12:00:00Z"));
      expect(result.year).toBe(2026);
      expect(result.weekNumber).toBe(36);
    });

    it("rolls into the next ISO year at the boundary", () => {
      // 2025-12-28 is ISO week 52 of 2025; the following week is ISO week 1 of 2026.
      const result = getNextIsoWeek(new Date("2025-12-28T12:00:00Z"));
      expect(result.year).toBe(2026);
      expect(result.weekNumber).toBe(1);
    });

    it("handles Sunday by jumping to the following ISO week", () => {
      // Sunday 2026-08-30 is still ISO week 35.
      const result = getNextIsoWeek(new Date("2026-08-30T03:05:00Z"));
      expect(result.year).toBe(2026);
      expect(result.weekNumber).toBe(36);
      expect(result.startDate.toISOString().startsWith("2026-08-31")).toBe(true);
      expect(result.endDate.toISOString().startsWith("2026-09-06")).toBe(true);
    });
  });

  describe("toWeekKey", () => {
    it("formats single-digit weeks with padding", () => {
      expect(toWeekKey(1)).toBe("WK-01");
      expect(toWeekKey(9)).toBe("WK-09");
    });

    it("formats double-digit weeks", () => {
      expect(toWeekKey(35)).toBe("WK-35");
      expect(toWeekKey(53)).toBe("WK-53");
    });
  });
});
