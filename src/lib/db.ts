import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

/**
 * Single Prisma client per process. In development, Next.js hot reload re-evaluates
 * modules, so the client is cached on globalThis to avoid exhausting connections.
 */
const globalForPrisma = globalThis as unknown as { leftoversPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env().DATABASE_URL, max: 10 });
  return new PrismaClient({ adapter });
}

export function db(): PrismaClient {
  globalForPrisma.leftoversPrisma ??= createClient();
  return globalForPrisma.leftoversPrisma;
}
