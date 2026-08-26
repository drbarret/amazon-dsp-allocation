import {
  addWeeks,
  endOfISOWeek,
  getISOWeek,
  getISOWeekYear,
  startOfISOWeek,
  subWeeks,
} from "date-fns";
import { UTCDate } from "@date-fns/utc";

export interface IsoWeek {
  year: number;
  weekNumber: number;
  startDate: Date;
  endDate: Date;
}

function toUtcDate(date: Date): UTCDate {
  return new UTCDate(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  );
}

/**
 * Returns ISO-week information for the given date, evaluated in UTC.
 * Defaults to the current date when none is provided.
 */
export function getCurrentIsoWeek(date: Date = new Date()): IsoWeek {
  const utc = toUtcDate(date);
  const year = getISOWeekYear(utc);
  const weekNumber = getISOWeek(utc);
  const startDate = startOfISOWeek(utc);
  const endDate = endOfISOWeek(utc);
  return { year, weekNumber, startDate, endDate };
}

/**
 * Returns ISO-week information for the week after the given date, evaluated in UTC.
 */
export function getNextIsoWeek(date: Date = new Date()): IsoWeek {
  return getCurrentIsoWeek(addWeeks(toUtcDate(date), 1));
}

/**
 * Returns ISO-week information for the week before the given date, evaluated in UTC.
 */
export function getPreviousIsoWeek(date: Date = new Date()): IsoWeek {
  return getCurrentIsoWeek(subWeeks(toUtcDate(date), 1));
}

/**
 * Formats a week number into the project's week-key convention (e.g. WK-35).
 */
export function toWeekKey(weekNumber: number): string {
  return `WK-${String(weekNumber).padStart(2, "0")}`;
}
