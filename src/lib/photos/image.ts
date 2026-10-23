import sharp, { type Metadata, type Sharp } from "sharp";
import { decodeHeicInWorker, HeicDecodeError } from "./heic";

/**
 * Photo processing (requirements MED-2, MED-3): identify the file by its signature (never
 * the name or the browser's claim), convert HEIC, apply the camera's rotation, strip all
 * metadata (EXIF, GPS, XMP, ICC), and produce responsive WebP sizes, one JPEG for link
 * previews and press downloads, and a tiny blur placeholder.
 *
 * Pure function of the input bytes: no storage, no database.
 */

export type ImageKind = "jpeg" | "png" | "webp" | "heic";

/** Browser-declared types accepted for upload, mapped to what the signature must show. */
export const ACCEPTED_TYPES: Readonly<Record<string, ImageKind>> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
};

export const ACCEPTED_EXTENSIONS: Readonly<Record<string, ImageKind>> = {
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
  heic: "heic",
  heif: "heic",
};

/** Largest image we'll decode (48 MP iPhone shots fit; decompression bombs don't). */
export const MAX_INPUT_PIXELS = 100_000_000;
/** Smallest useful photo edge. */
export const MIN_EDGE_PX = 200;
/** Responsive widths. Never upscaled: smaller originals get their own width as the largest. */
export const VARIANT_WIDTHS = [480, 960, 1600, 2400] as const;
export const JPEG_MAX_WIDTH = 2400;
const BLUR_WIDTH = 16;
const WEBP_QUALITY = 80;
const JPEG_QUALITY = 82;

// Every upload is a different image, so libvips' operation cache only holds memory.
sharp.cache(false);

/** A file we won't use. `message` is safe to show the uploader. */
export class ImageRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageRejectedError";
  }
}

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis"]);
const GENERIC_HEIF_BRANDS = new Set(["mif1", "msf1"]);
/** Only the first part of the ftyp box is scanned for brands. */
const MAX_FTYP_BYTES = 256;

function ascii(buffer: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...buffer.subarray(start, end));
}

/** HEIF files start with an `ftyp` box: size, "ftyp", major brand, minor version, compatible brands. */
function isHeic(buffer: Buffer): boolean {
  if (buffer.length < 16 || ascii(buffer, 4, 8) !== "ftyp") return false;
  const boxSize = Math.min(buffer.readUInt32BE(0), buffer.length, MAX_FTYP_BYTES);
  const brands = [ascii(buffer, 8, 12)];
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) brands.push(ascii(buffer, offset, offset + 4));
  // AVIF shares the generic mif1/msf1 brands; only accept files that declare HEVC (HEIC) content.
  if (brands.some((brand) => brand === "avif" || brand === "avis")) return false;
  const major = brands[0] ?? "";
  return HEIC_BRANDS.has(major) || (GENERIC_HEIF_BRANDS.has(major) && brands.some((brand) => HEIC_BRANDS.has(brand)));
}

/** Identifies the image type from its leading bytes, or null if it isn't one we accept. */
export function sniffImageKind(input: Uint8Array): ImageKind | null {
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (buffer.length >= 12 && ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 12) === "WEBP") return "webp";
  if (isHeic(buffer)) return "heic";
  return null;
}

export interface ProcessedFile {
  readonly kind: "webp" | "jpeg";
  readonly width: number;
  readonly height: number;
  readonly contentType: "image/webp" | "image/jpeg";
  readonly data: Buffer;
}

export interface ProcessedPhoto {
  readonly width: number;
  readonly height: number;
  /** WebP sizes, smallest first. */
  readonly variants: readonly ProcessedFile[];
  readonly jpeg: ProcessedFile;
  readonly blurDataUrl: string;
}

/** Widths to render for an image of the given (upright) width. */
export function variantWidths(width: number): number[] {
  const largest = Math.min(width, VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1] ?? width);
  const widths = VARIANT_WIDTHS.filter((target) => target < largest);
  return [...widths, largest];
}

function checkDimensions(width: number, height: number): void {
  if (width * height > MAX_INPUT_PIXELS) {
    throw new ImageRejectedError("This photo is too large (over 100 megapixels).");
  }
  if (Math.min(width, height) < MIN_EDGE_PX) {
    throw new ImageRejectedError(`This photo is too small (under ${MIN_EDGE_PX} pixels on a side).`);
  }
}

/** HEIC: decode to raw pixels (libheif applies the file's rotation), then hand to sharp. */
async function heicToSharp(input: Buffer): Promise<{ image: Sharp; width: number; height: number }> {
  let decoded: Awaited<ReturnType<typeof decodeHeicInWorker>>;
  try {
    decoded = await decodeHeicInWorker(input, MAX_INPUT_PIXELS);
  } catch (error) {
    if (error instanceof HeicDecodeError && error.reason === "too-large") {
      throw new ImageRejectedError("This photo is too large (over 100 megapixels).");
    }
    if (error instanceof HeicDecodeError) {
      throw new ImageRejectedError("This HEIC photo couldn't be read. Try exporting it as JPEG.");
    }
    throw error;
  }
  checkDimensions(decoded.width, decoded.height);
  const image = sharp(decoded.data, { raw: { width: decoded.width, height: decoded.height, channels: 4 } }).removeAlpha();
  return { image, width: decoded.width, height: decoded.height };
}

/** JPEG/PNG/WebP: sharp decodes; `.rotate()` applies the EXIF orientation. */
async function rasterToSharp(input: Buffer): Promise<{ image: Sharp; width: number; height: number }> {
  const base = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false });
  let metadata: Metadata;
  try {
    metadata = await base.metadata();
  } catch (error) {
    // sharp refuses to even read the header of images over limitInputPixels.
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      throw new ImageRejectedError("This photo is too large (over 100 megapixels).");
    }
    throw new ImageRejectedError("This photo couldn't be read. The file may be damaged.");
  }
  if (!metadata.width || !metadata.height) throw new ImageRejectedError("This photo couldn't be read.");
  // EXIF orientations 5-8 rotate by 90°, swapping width and height.
  const swapped = (metadata.orientation ?? 1) >= 5;
  const width = swapped ? metadata.height : metadata.width;
  const height = swapped ? metadata.width : metadata.height;
  checkDimensions(width, height);
  return { image: base.rotate(), width, height };
}

async function render(image: Sharp, width: number, kind: "webp" | "jpeg"): Promise<ProcessedFile> {
  const resized = image.clone().resize({ width, withoutEnlargement: true });
  const encoded =
    kind === "webp"
      ? resized.webp({ quality: WEBP_QUALITY, effort: 4 })
      : resized.flatten({ background: "#ffffff" }).jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
  try {
    // sharp writes no metadata unless asked (withMetadata/keepExif), so EXIF/GPS never survive.
    const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
    return {
      kind,
      width: info.width,
      height: info.height,
      contentType: kind === "webp" ? "image/webp" : "image/jpeg",
      data,
    };
  } catch {
    throw new ImageRejectedError("This photo couldn't be processed. The file may be damaged.");
  }
}

/**
 * Validates and processes an uploaded photo. `declared` is the type the browser claimed;
 * the file's signature must agree. Throws ImageRejectedError for unusable files.
 */
export async function processPhoto(input: Buffer, declared: ImageKind): Promise<ProcessedPhoto> {
  const actual = sniffImageKind(input);
  if (!actual) throw new ImageRejectedError("This file isn't a JPEG, PNG, WebP, or HEIC photo.");
  if (actual !== declared) throw new ImageRejectedError("This file's contents don't match its type.");

  const { image, width, height } = actual === "heic" ? await heicToSharp(input) : await rasterToSharp(input);
  // Convert to sRGB once (wide-gamut phone photos would otherwise look washed out in some browsers).
  const normalized = image.toColourspace("srgb");

  const variants: ProcessedFile[] = [];
  for (const target of variantWidths(width)) {
    variants.push(await render(normalized, target, "webp"));
  }
  const jpeg = await render(normalized, Math.min(JPEG_MAX_WIDTH, width), "jpeg");
  const blur = await normalized.clone().resize({ width: BLUR_WIDTH }).webp({ quality: 40 }).toBuffer();

  return {
    width,
    height,
    variants,
    jpeg,
    blurDataUrl: `data:image/webp;base64,${blur.toString("base64")}`,
  };
}
