import { db } from "../db";
import { logger } from "../logger";
import { runBookingJobs } from "./booking-jobs";

/**
 * In-process scheduler. One small job every 10 minutes doesn't justify a separate worker
 * service (requirements §1.1); the advisory lock in runBookingJobs keeps it correct if the
 * app ever runs more than one instance.
 */

const INTERVAL_MS = 10 * 60_000;
const FIRST_RUN_DELAY_MS = 30_000;

let started = false;

async function tick(): Promise<void> {
  try {
    await runBookingJobs(db());
  } catch (error) {
    logger.error({ err: error }, "booking jobs failed");
  }
}

export function startScheduler(): void {
  if (started) return;
  started = true;
  setTimeout(() => void tick(), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void tick(), INTERVAL_MS).unref();
  logger.info({ intervalMinutes: INTERVAL_MS / 60_000 }, "scheduler started");
}
