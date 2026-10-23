// HEIC decoder, run in a short-lived worker thread (see heic.ts).
// libheif's WebAssembly heap grows to hundreds of MB for a phone photo and never shrinks,
// so decoding happens here and the worker is terminated afterwards, returning the memory.
import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

const require = createRequire(import.meta.url);
const decodeHeic = require("heic-decode");

const { buffer, maxPixels } = workerData;

async function run() {
  const images = await decodeHeic.all({ buffer: new Uint8Array(buffer) });
  try {
    const primary = images[0];
    if (!primary) return { error: "empty" };
    if (primary.width * primary.height > maxPixels) {
      return { error: "too-large", width: primary.width, height: primary.height };
    }
    const decoded = await primary.decode();
    return { width: decoded.width, height: decoded.height, data: decoded.data };
  } finally {
    images.dispose();
  }
}

run().then(
  (result) => parentPort.postMessage(result, result.data ? [result.data.buffer] : []),
  () => parentPort.postMessage({ error: "unreadable" }),
);
