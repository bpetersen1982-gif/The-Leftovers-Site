import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Approximate distance between ZIP codes (requirements ELIG-2) using the bundled Census
 * ZCTA table (data/zcta/zcta-2025.csv, public domain). No network calls, no API keys.
 */

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

const ZCTA_FILE = path.join(process.cwd(), "data", "zcta", "zcta-2025.csv");
const EARTH_RADIUS_MILES = 3958.8;

let table: Promise<ReadonlyMap<string, LatLng>> | undefined;

/** Parses "zip,lat,lng" lines. Exported for tests. */
export function parseZctaCsv(csv: string): Map<string, LatLng> {
  const map = new Map<string, LatLng>();
  for (const line of csv.split("\n").slice(1)) {
    const [zip, lat, lng] = line.trim().split(",");
    if (!zip || !lat || !lng || !/^\d{5}$/.test(zip)) continue;
    const point = { lat: Number(lat), lng: Number(lng) };
    if (Number.isFinite(point.lat) && Number.isFinite(point.lng)) map.set(zip, point);
  }
  return map;
}

/** Loads the table once per process (~34k rows). A failed load is retried next call. */
function loadTable(): Promise<ReadonlyMap<string, LatLng>> {
  table ??= readFile(ZCTA_FILE, "utf8")
    .then(parseZctaCsv)
    .catch((error: unknown) => {
      table = undefined;
      throw new Error(`Could not load ZIP table from ${path.relative(process.cwd(), ZCTA_FILE)}`, { cause: error });
    });
  return table;
}

export async function lookupZip(zip: string): Promise<LatLng | null> {
  if (!/^\d{5}$/.test(zip)) return null;
  return (await loadTable()).get(zip) ?? null;
}

/** Great-circle ("straight line") distance in miles. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Miles between two ZIPs, rounded to one decimal, or null if either ZIP is unknown. */
export async function milesBetweenZips(fromZip: string, toZip: string): Promise<number | null> {
  const [from, to] = await Promise.all([lookupZip(fromZip), lookupZip(toZip)]);
  if (!from || !to) return null;
  return Math.round(haversineMiles(from, to) * 10) / 10;
}

/** Towns shown on the pricing page so Admins can see what a radius means. */
export const SAMPLE_TOWNS = [
  { name: "Seward", zip: "68434" },
  { name: "Beatrice", zip: "68310" },
  { name: "Omaha (west)", zip: "68154" },
  { name: "Fremont", zip: "68025" },
  { name: "Nebraska City", zip: "68410" },
  { name: "York", zip: "68467" },
  { name: "Omaha (downtown)", zip: "68102" },
  { name: "Council Bluffs, IA", zip: "51501" },
  { name: "Columbus", zip: "68601" },
  { name: "Grand Island", zip: "68801" },
  { name: "Manhattan, KS", zip: "66502" },
  { name: "Kearney", zip: "68847" },
  { name: "Kansas City, MO", zip: "64105" },
] as const;
