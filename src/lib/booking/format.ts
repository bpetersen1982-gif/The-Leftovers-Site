/** Formatting shared by server emails and client components (no server imports here). */

const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });

/** "20:00" -> "8:00 PM". */
export function formatTime(time: string | null): string {
  if (!time) return "";
  return TIME.format(new Date(`1970-01-01T${time}:00Z`));
}
