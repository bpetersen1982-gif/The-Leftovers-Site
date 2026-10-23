import path from "node:path";
import { Worker } from "node:worker_threads";

/**
 * Decodes HEIC/HEIF (iPhone photos) to RGBA pixels in a throwaway worker thread.
 *
 * sharp's prebuilt binaries can't decode HEIC, so libheif (WebAssembly) does it. Its heap
 * grows to several hundred MB per photo and WebAssembly memory is never returned to the
 * OS, so a worker is started per decode and terminated afterwards (measured: ~650 MB RSS
 * when decoding in-process vs. back to baseline with the worker).
 *
 * The worker file is loaded from the source tree (not the Next.js bundle), which is
 * present at runtime because the app is started from the repository with `next start`.
 */

const WORKER_PATH = path.join(process.cwd(), "src", "lib", "photos", "heic-worker.mjs");
const DECODE_TIMEOUT_MS = 60_000;

export interface DecodedPixels {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 bytes per pixel. */
  readonly data: Buffer;
}

export type HeicFailure = "unreadable" | "empty" | "too-large" | "timeout";

export class HeicDecodeError extends Error {
  constructor(readonly reason: HeicFailure) {
    super(`HEIC decode failed: ${reason}`);
    this.name = "HeicDecodeError";
  }
}

type WorkerReply =
  | { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray }
  | { readonly error: Exclude<HeicFailure, "timeout"> };

export async function decodeHeicInWorker(input: Buffer, maxPixels: number): Promise<DecodedPixels> {
  // Copy so the transferred ArrayBuffer is ours alone (Buffers can share a pooled slab).
  const copy = new Uint8Array(input);
  const worker = new Worker(WORKER_PATH, {
    workerData: { buffer: copy.buffer, maxPixels },
    transferList: [copy.buffer],
  });

  try {
    const reply = await new Promise<WorkerReply>((resolve, reject) => {
      const timer = setTimeout(() => reject(new HeicDecodeError("timeout")), DECODE_TIMEOUT_MS);
      worker.once("message", (message: WorkerReply) => {
        clearTimeout(timer);
        resolve(message);
      });
      worker.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      worker.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`HEIC worker exited early with code ${code}`));
      });
    });
    if ("error" in reply) throw new HeicDecodeError(reply.error);
    return {
      width: reply.width,
      height: reply.height,
      data: Buffer.from(reply.data.buffer, reply.data.byteOffset, reply.data.byteLength),
    };
  } finally {
    await worker.terminate();
  }
}
