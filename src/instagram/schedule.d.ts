// Types for schedule.js. The implementation is plain JavaScript so node:test
// and the browser bundle share one copy of it; these declarations are what the
// TypeScript side sees.
import type { PullSchedule } from './data';

/** The schedule `instagram-schedule.sh install` uses when given no time. */
export declare const DEFAULT_SCHEDULE: PullSchedule;

/**
 * The schedule to reason with, and whether it's the real one or the documented
 * default standing in for a file that carries none.
 */
export declare function resolveSchedule(
  schedule: PullSchedule | undefined,
): { schedule: PullSchedule; assumed: boolean };

/** The wall clock in `timeZone` at a given instant. */
export declare function zonedParts(
  date: Date,
  timeZone?: string,
): { year: number; month: number; day: number; hour: number; minute: number };

/** The instant at which `timeZone`'s wall clock reads these parts. */
export declare function instantFrom(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone?: string,
): Date;

/**
 * The next time the job will actually try, or null when no schedule is on file.
 * `satisfied` means today's pull is already in, so the answer is tomorrow's
 * first slot rather than the top of the next hour.
 */
export declare function nextAttempt(
  schedule: PullSchedule | undefined,
  generatedAt: string | undefined,
  now?: Date,
): { at: Date; satisfied: boolean } | null;

export declare function formatClock(date: Date, timeZone?: string): string;
export declare function formatDayLabel(date: Date, now: Date, timeZone?: string): string;
export declare function formatRelative(date: Date, now?: Date): string;
export declare function describeWindow(schedule: PullSchedule | undefined, now?: Date): string;
export declare function zoneAbbrev(date: Date, timeZone?: string): string;
