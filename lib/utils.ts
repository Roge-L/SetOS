// Timezone for date-boundary logic.
// Timestamps are always stored as UTC in the database.
// This is only used to determine "what day is it" and query boundaries.
//
// Cloudflare Workers run in UTC — there is no system timezone.
// We must explicitly convert using Intl APIs.
// Ref: https://github.com/cloudflare/workerd/issues/2328
const TIMEZONE = "America/New_York";

// Today's date in local timezone as YYYY-MM-DD
export function todayDate(): string {
  return dateInTimezone(new Date());
}

// Format a Date as YYYY-MM-DD in local timezone
// Uses en-CA locale which reliably produces YYYY-MM-DD in V8 runtimes.
// Ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toLocaleDateString
export function dateInTimezone(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

// Get UTC start and end boundaries for a local date.
// Example: "2026-04-03" in America/New_York (EDT, UTC-4) →
//   start: "2026-04-03T04:00:00.000Z" (midnight ET in UTC)
//   end:   "2026-04-04T03:59:59.999Z" (11:59:59 PM ET in UTC)
//
// Uses Intl.DateTimeFormat to compute the exact UTC offset for the given date,
// which correctly handles DST transitions.
// Ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat
export function getUTCRangeForLocalDate(localDate: string): {
  start: string;
  end: string;
} {
  // Use a known UTC time and see what the local time is, to derive offset.
  // We use noon UTC on the target date to avoid DST edge cases at midnight.
  const probeUTC = new Date(`${localDate}T12:00:00.000Z`);

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

  const parts = formatter.formatToParts(probeUTC);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value || "00";

  // Build the local time string that Intl reports for our probe
  const localHour = parseInt(get("hour"));
  // offset = UTC hour - local hour (at the probe point, UTC is 12)
  const offsetHours = 12 - localHour;
  const offsetMs = offsetHours * 60 * 60 * 1000;

  // Midnight of localDate in UTC = midnight local + offset
  const startUTC = new Date(
    new Date(`${localDate}T00:00:00.000Z`).getTime() + offsetMs
  );
  // End of day
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
