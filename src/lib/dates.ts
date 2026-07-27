/**
 * Timezone-aware date helpers.
 *
 * Every function here takes the timezone explicitly, because it belongs to the
 * person making the request (`users.timezone`), not to the server. A meal eaten
 * at 11pm belongs to that day in the eater's zone, not to the next UTC day — so
 * "today", day boundaries, and per-day queries all resolve against that zone,
 * matching the `recalculate_daily_totals()` SQL function, which looks up the
 * same value and groups on `date(logged_at at time zone <user's zone>)`.
 *
 * Implementation uses `Intl.DateTimeFormat`, which is available in Workers and
 * handles DST transitions correctly (offsets are computed per-instant, not fixed).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** True when `s` is a real YYYY-MM-DD date (rejects e.g. 2026-13-40). */
export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Throws a clear error if `s` isn't a valid YYYY-MM-DD date. */
export function assertDate(s: string, field = "date"): string {
  if (!isValidDate(s)) {
    throw new Error(`Invalid ${field} "${s}". Use YYYY-MM-DD (e.g. 2026-07-23).`);
  }
  return s;
}

/**
 * Minutes `tz` is ahead of UTC at the given instant (negative for the Americas).
 * e.g. America/New_York in July → -240.
 */
function tzOffsetMinutes(instant: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  // Reading the wall clock as if it were UTC, minus the true instant, is the offset.
  const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUTC - instant.getTime()) / 60000;
}

/** The UTC instant corresponding to a local wall-clock time in `tz`. */
export function localWallToUTC(
  dateStr: string,
  hours: number,
  minutes: number,
  seconds: number,
  tz: string
): Date {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, hours, minutes, seconds);
  // Correct the naive guess by the zone's offset at (approximately) that instant.
  const offset = tzOffsetMinutes(new Date(guess), tz);
  return new Date(guess - offset * 60000);
}

/** Wall-clock parts (date + time) for an instant, rendered in `tz`. */
function wallParts(instant: Date, tz: string) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    // Intl can emit "24" for midnight in some engines; normalize to "00".
    hour: get("hour") === "24" ? "00" : get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Local calendar date (YYYY-MM-DD) for an instant, in `tz`. */
export function dateInTimezone(instant: Date, tz: string): string {
  return wallParts(instant, tz).date;
}

/** Local wall-clock time as "HH:MM" for an instant, in `tz`. */
export function timeOfDayInTimezone(instant: Date, tz: string): string {
  const p = wallParts(instant, tz);
  return `${p.hour}:${p.minute}`;
}

/** Today's local date (YYYY-MM-DD) in `tz`. */
export function todayDate(tz: string): string {
  return dateInTimezone(new Date(), tz);
}

/** Current local time-of-day as {hours, minutes, seconds} in `tz`. */
export function currentTimeOfDay(tz: string): { hours: number; minutes: number; seconds: number } {
  const p = wallParts(new Date(), tz);
  return { hours: Number(p.hour), minutes: Number(p.minute), seconds: Number(p.second) };
}

/**
 * The UTC half-open range [start, end) that covers one local day. Query
 * `logged_at >= start AND logged_at < end` to get exactly that day's rows,
 * correct across DST.
 */
export function utcRangeForLocalDate(dateStr: string, tz: string): { start: string; end: string } {
  const start = localWallToUTC(dateStr, 0, 0, 0, tz);
  const nextDay = shiftDate(dateStr, 1);
  const end = localWallToUTC(nextDay, 0, 0, 0, tz);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Add (or subtract) whole days from a YYYY-MM-DD string. */
export function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  // Anchor at noon UTC so DST shifts can't roll the date across a boundary.
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Inclusive list of YYYY-MM-DD strings from `start` to `end`. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  // Guard against an inverted range or a runaway loop (cap at ~1 year).
  for (let i = 0; i < 400 && cur <= end; i++) {
    out.push(cur);
    cur = shiftDate(cur, 1);
  }
  return out;
}
