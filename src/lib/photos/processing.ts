import { Semaphore } from "../semaphore";
import type { ObjectStorage } from "../storage";
import { privateFileKey, type StoredFile } from "./files";
import type { ProcessedPhoto } from "./image";

/**
 * Shared by band photos and fan photos: image processing is CPU- and memory-heavy, so at
 * most this many run at once per app instance, whichever kind of upload they are.
 */
export const processingSlots = new Semaphore(2);

/** Writes processed sizes (w{width}.webp + full.jpg) to the private bucket under `ownerId`. */
export async function storeProcessedFiles(storage: ObjectStorage, ownerId: string, result: ProcessedPhoto): Promise<StoredFile[]> {
  const stored: StoredFile[] = [];
  const entries = [...result.variants.map((file) => ({ file, name: `w${file.width}.webp` })), { file: result.jpeg, name: "full.jpg" }];
  for (const { file, name } of entries) {
    await storage.putPrivate(privateFileKey(ownerId, name), file.data, file.contentType);
    stored.push({ file: name, kind: file.kind, width: file.width, height: file.height, contentType: file.contentType, bytes: file.data.byteLength });
  }
  return stored;
}
