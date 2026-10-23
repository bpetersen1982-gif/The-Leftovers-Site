import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import sharp, { type Sharp } from "sharp";
import { describe, expect, it } from "vitest";
import { ImageRejectedError, processPhoto, sniffImageKind, variantWidths } from "@/lib/photos/image";

const HEIC_FIXTURE = readFileSync(new URL("../fixtures/photos/sample.heic", import.meta.url));

/** Left half red, right half blue, so rotation is detectable. */
function twoTone(width: number, height: number): Sharp {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const left = x < width / 2;
      pixels[offset] = left ? 220 : 20;
      pixels[offset + 1] = 60;
      pixels[offset + 2] = left ? 20 : 220;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

function variantData(result: { variants: readonly { data: Buffer }[] }, index: number): Buffer {
  const variant = result.variants[index];
  if (!variant) throw new Error(`missing variant ${index}`);
  return variant.data;
}

async function pixelAt(file: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0];
}

describe("sniffImageKind", () => {
  it("identifies each accepted type by signature", async () => {
    const base = twoTone(300, 300);
    expect(sniffImageKind(await base.clone().jpeg().toBuffer())).toBe("jpeg");
    expect(sniffImageKind(await base.clone().png().toBuffer())).toBe("png");
    expect(sniffImageKind(await base.clone().webp().toBuffer())).toBe("webp");
    expect(sniffImageKind(HEIC_FIXTURE)).toBe("heic");
  });

  it("rejects other files, including AVIF and look-alikes", async () => {
    expect(sniffImageKind(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImageKind(Buffer.from("GIF89a......"))).toBeNull();
    expect(sniffImageKind(Buffer.alloc(0))).toBeNull();
    const avif = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from("ftypavif\0\0\0\0mif1miafMA1B")]);
    expect(sniffImageKind(avif)).toBeNull();
    const genericAvif = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmif1\0\0\0\0avifmiaf")]);
    expect(sniffImageKind(genericAvif)).toBeNull();
  });
});

describe("variantWidths", () => {
  it("never upscales and caps at 2400", () => {
    expect(variantWidths(4032)).toEqual([480, 960, 1600, 2400]);
    expect(variantWidths(1600)).toEqual([480, 960, 1600]);
    expect(variantWidths(1000)).toEqual([480, 960, 1000]);
    expect(variantWidths(300)).toEqual([300]);
  });
});

describe("processPhoto", () => {
  it("applies EXIF rotation and strips all metadata", async () => {
    // 600x400 stored sideways (orientation 6 = rotate 90° clockwise to view), with EXIF and GPS.
    const input = await twoTone(600, 400)
      .withExif({ IFD0: { Make: "TestCam", Model: "Leak 1" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 48/1 0/1" } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const result = await processPhoto(input, "jpeg");
    expect({ width: result.width, height: result.height }).toEqual({ width: 400, height: 600 });
    expect(result.variants.map((variant) => [variant.width, variant.height])).toEqual([[400, 600]]);

    for (const file of [...result.variants, result.jpeg]) {
      const metadata = await sharp(file.data).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
      expect(file.data.includes(Buffer.from("TestCam"))).toBe(false);
    }
    // After rotating clockwise, the original left (red) half is on top.
    const top = await pixelAt(variantData(result, 0), 200, 50);
    const bottom = await pixelAt(variantData(result, 0), 200, 550);
    expect(top[0]).toBeGreaterThan(150);
    expect(bottom[2]).toBeGreaterThan(150);
  });

  it("produces responsive WebP sizes, a preview JPEG, and a blur placeholder", async () => {
    const input = await twoTone(2000, 1000).png().toBuffer();
    const result = await processPhoto(input, "png");
    expect(result.variants.map((variant) => variant.width)).toEqual([480, 960, 1600, 2000]);
    expect(result.variants.every((variant) => variant.contentType === "image/webp")).toBe(true);
    expect(result.variants.map((variant) => variant.height)).toEqual([240, 480, 800, 1000]);
    expect(sniffImageKind(variantData(result, 0))).toBe("webp");
    expect(result.jpeg).toMatchObject({ width: 2000, height: 1000, contentType: "image/jpeg" });
    expect(sniffImageKind(result.jpeg.data)).toBe("jpeg");
    expect(result.blurDataUrl).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/);
    expect(result.blurDataUrl.length).toBeLessThan(1000);
  });

  it("converts HEIC", async () => {
    const result = await processPhoto(HEIC_FIXTURE, "heic");
    expect({ width: result.width, height: result.height }).toEqual({ width: 640, height: 480 });
    expect(result.variants.map((variant) => variant.width)).toEqual([480, 640]);
    const left = await pixelAt(variantData(result, 1), 50, 240);
    const right = await pixelAt(variantData(result, 1), 590, 240);
    expect(left[0]).toBeGreaterThan(150);
    expect(right[2]).toBeGreaterThan(150);
  });

  it("rejects mismatched, damaged, tiny, and non-image files", async () => {
    const jpeg = await twoTone(400, 400).jpeg().toBuffer();
    await expect(processPhoto(jpeg, "png")).rejects.toThrow(/don't match/);
    await expect(processPhoto(Buffer.from("<html>"), "jpeg")).rejects.toBeInstanceOf(ImageRejectedError);
    await expect(processPhoto(jpeg.subarray(0, 200), "jpeg")).rejects.toBeInstanceOf(ImageRejectedError);
    const tiny = await twoTone(150, 400).jpeg().toBuffer();
    await expect(processPhoto(tiny, "jpeg")).rejects.toThrow(/too small/);
    await expect(processPhoto(HEIC_FIXTURE.subarray(0, 300), "heic")).rejects.toBeInstanceOf(ImageRejectedError);
  });

  it("rejects decompression bombs without decoding them", async () => {
    // A small PNG whose header claims 20000x20000 pixels (IHDR rewritten with a valid CRC).
    const bomb = Buffer.from(await twoTone(300, 300).png().toBuffer());
    bomb.writeUInt32BE(20_000, 16);
    bomb.writeUInt32BE(20_000, 20);
    bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)), 29);
    await expect(processPhoto(bomb, "png")).rejects.toThrow(/too large/);
  });
});
