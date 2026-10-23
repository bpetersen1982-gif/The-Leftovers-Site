import { randomUUID } from "node:crypto";

/**
 * Lets trusted server code (invite acceptance) obtain a freshly minted magic-link URL
 * instead of emailing it, so a new member who just clicked their invite is logged in
 * immediately rather than waiting for a second email.
 *
 * Safety: a capture only happens when the server registered the id in this process
 * moments earlier. A client that sends `metadata.captureId` itself can't register one,
 * so its link is emailed to the account owner as usual, and the HTTP response never
 * contains the URL either way.
 */

const CAPTURE_TTL_MS = 30_000;

interface Slot {
  url: string | null;
  readonly expiresAt: number;
}

const slots = new Map<string, Slot>();

function sweep(now: number): void {
  for (const [id, slot] of slots) if (slot.expiresAt <= now) slots.delete(id);
}

export function openCapture(): string {
  const now = Date.now();
  sweep(now);
  const id = randomUUID();
  slots.set(id, { url: null, expiresAt: now + CAPTURE_TTL_MS });
  return id;
}

/** Called from sendMagicLink. Returns true if the URL was captured (and must not be emailed). */
export function tryCapture(captureId: unknown, url: string): boolean {
  if (typeof captureId !== "string") return false;
  const slot = slots.get(captureId);
  if (!slot || slot.expiresAt <= Date.now() || slot.url !== null) return false;
  slot.url = url;
  return true;
}

/** Returns the captured URL once and removes the slot. */
export function closeCapture(captureId: string): string | null {
  const slot = slots.get(captureId);
  slots.delete(captureId);
  return slot?.url ?? null;
}
