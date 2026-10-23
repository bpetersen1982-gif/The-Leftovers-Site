import type { PrismaClient } from "@/generated/prisma/client";
import type { ObjectStorage } from "../storage";

/** What the photo services need; injected so tests use the test database and buckets. */
export interface PhotoDeps {
  readonly prisma: PrismaClient;
  readonly storage: ObjectStorage;
  /** Clock override for tests. */
  readonly now?: () => Date;
}
