import { beforeEach, describe, expect, it } from "vitest";
import { ObjectTooLargeError, storageConfig } from "@/lib/storage";
import { createTestStorage, resetStorage, TEST_STORAGE_ENV } from "../support/storage";

const storage = createTestStorage();

async function presignedPut(key: string, body: Uint8Array<ArrayBuffer>, signedLength: number, contentType = "image/jpeg") {
  const upload = await storage.presignPrivateUpload({
    key,
    contentType: "image/jpeg",
    contentLength: signedLength,
    expiresInSeconds: 60,
  });
  return fetch(upload.url, { method: "PUT", headers: { "Content-Type": contentType }, body });
}

describe("object storage (local S3 server)", () => {
  beforeEach(async () => {
    await resetStorage();
  });

  it("accepts a presigned upload that matches the signed size and type", async () => {
    const body = new Uint8Array(1234).fill(7);
    const response = await presignedPut("uploads/probe/original", body, body.byteLength);
    expect(response.status).toBe(200);
    expect(await storage.headPrivate("uploads/probe/original")).toEqual({ size: 1234, contentType: "image/jpeg" });
    expect(await storage.readPrivate("uploads/probe/original", 2000)).toEqual(Buffer.from(body));
  });

  it("rejects a presigned upload with a different size or content type", async () => {
    const body = new Uint8Array(2000).fill(1);
    const wrongSize = await presignedPut("uploads/probe/size", body, 1000);
    expect(wrongSize.ok).toBe(false);
    const wrongType = await presignedPut("uploads/probe/type", new Uint8Array(10), 10, "text/html");
    expect(wrongType.ok).toBe(false);
    expect(await storage.headPrivate("uploads/probe/size")).toBeNull();
    expect(await storage.headPrivate("uploads/probe/type")).toBeNull();
  });

  it("refuses to read objects over the limit", async () => {
    await storage.putPrivate("uploads/probe/big", Buffer.alloc(5000), "image/jpeg");
    await expect(storage.readPrivate("uploads/probe/big", 4999)).rejects.toBeInstanceOf(ObjectTooLargeError);
  });

  it("publishes a private object to the public bucket and deletes it again", async () => {
    await storage.putPrivate("variants/a/960.webp", Buffer.from("webp-bytes"), "image/webp");
    const anonymousPrivate = await fetch(`${TEST_STORAGE_ENV.STORAGE_ENDPOINT}/${TEST_STORAGE_ENV.R2_PRIVATE_BUCKET}/variants/a/960.webp`);
    expect(anonymousPrivate.ok).toBe(false);

    await storage.publish("variants/a/960.webp", "photos/a/x-960.webp", {
      contentType: "image/webp",
      cacheControl: "public, max-age=3600",
    });
    const url = storage.publicUrlFor("photos/a/x-960.webp");
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await response.text()).toBe("webp-bytes");

    await storage.deletePublic(["photos/a/x-960.webp", "photos/a/missing.webp"]);
    expect((await fetch(url)).ok).toBe(false);
    await storage.deletePrivate(["variants/a/960.webp"]);
    expect(await storage.headPrivate("variants/a/960.webp")).toBeNull();
  });

  it("refuses unsafe keys", async () => {
    await expect(storage.putPrivate("../etc/passwd", Buffer.from("x"), "text/plain")).rejects.toThrow(/unsafe/);
    expect(() => storage.publicUrlFor("photos//a")).toThrow(/unsafe/);
  });
});

describe("storageConfig", () => {
  const base = {
    R2_ACCOUNT_ID: "d178cadcd0d26cd450d20e1892f4543f",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_PRIVATE_BUCKET: "leftovers-media-private",
    R2_PUBLIC_BUCKET: "leftovers-media-public",
    R2_PUBLIC_URL: "https://media.theleftoversband.com/",
  };

  it("is null when nothing is set and derives the R2 endpoint otherwise", () => {
    expect(storageConfig({})).toBeNull();
    expect(storageConfig(base)).toMatchObject({
      endpoint: "https://d178cadcd0d26cd450d20e1892f4543f.r2.cloudflarestorage.com",
      publicUrl: "https://media.theleftoversband.com",
    });
  });

  it("throws on partial or unsafe configuration", () => {
    expect(() => storageConfig({ R2_ACCESS_KEY_ID: "key" })).toThrow(/Invalid storage configuration/);
    expect(() => storageConfig({ ...base, R2_PUBLIC_BUCKET: base.R2_PRIVATE_BUCKET })).toThrow(/must differ/);
    const production = { NODE_ENV: "production", LEFTOVERS_ENV: "production" };
    expect(() => storageConfig({ ...base, ...production, STORAGE_ENDPOINT: "http://127.0.0.1:9100" })).toThrow(/production/);
    expect(() => storageConfig({ ...base, ...production, R2_PUBLIC_URL: "http://media.example" })).toThrow(/production/);
    expect(storageConfig({ ...base, ...production })).not.toBeNull();
  });
});
