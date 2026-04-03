// Timezone for date-boundary logic.
// Timestamps are always stored as UTC in the database.
// This is only used to determine "what day is it" and query boundaries.
const TIMEZONE = "America/New_York";

// Today's date in local timezone as YYYY-MM-DD
export function todayDate(): string {
  return dateInTimezone(new Date());
}

// Format a Date as YYYY-MM-DD in local timezone
// Uses en-CA locale which reliably produces YYYY-MM-DD in V8 runtimes.
// Source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toLocaleDateString
export function dateInTimezone(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

// Get UTC start and end boundaries for a local date.
// Example: "2026-04-03" in America/New_York →
//   start: "2026-04-03T04:00:00.000Z" (midnight ET in UTC)
//   end:   "2026-04-04T03:59:59.999Z" (11:59:59 PM ET in UTC)
//
// This is critical for querying "today's" data from a UTC database.
// Source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat
export function getUTCRangeForLocalDate(localDate: string): {
  start: string;
  end: string;
} {
  // Create a date at midnight in the target timezone
  // by finding the UTC offset for that date
  const midnight = new Date(`${localDate}T00:00:00`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  // Find the offset by comparing what time the formatter shows vs what we set
  // Alternative approach: manually compute using known offset
  const parts = formatter.formatToParts(midnight);
  const getPart = (type: string) =>
    parts.find((p) => p.type === type)?.value || "0";

  const localStr = `${getPart("year")}-${getPart("month")}-${getPart("day")}T${getPart("hour")}:${getPart("minute")}:${getPart("second")}`;
  const localTime = new Date(localStr).getTime();
  const utcTime = midnight.getTime();
  const offsetMs = utcTime - localTime;

  // Midnight of localDate in UTC
  const startUTC = new Date(
    new Date(`${localDate}T00:00:00.000Z`).getTime() + offsetMs
  );
  // End of day (23:59:59.999) of localDate in UTC
  const endUTC = new Date(
    new Date(`${localDate}T23:59:59.999Z`).getTime() + offsetMs
  );

  return {
    start: startUTC.toISOString(),
    end: endUTC.toISOString(),
  };
}

export function formatDate(date: string): string {
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatDateLong(date: string): string {
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    timeZone: TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function startOfWeek(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return dateInTimezone(d);
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
