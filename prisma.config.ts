import { config as loadDotenv } from "dotenv";
import { defineConfig } from "prisma/config";
import { resolveDatabaseUrl } from "./src/lib/database-url";

// Load .env without overriding the shell. Isolation from other projects comes from the
// project-specific variable name and the guard in resolveDatabaseUrl, not from override.
loadDotenv({ quiet: true });

/**
 * Prisma CLI configuration (migrate, generate, seed). Throws before any connection
 * is attempted if the URL is missing or doesn't point at a Leftovers database.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: resolveDatabaseUrl(process.env),
  },
});
