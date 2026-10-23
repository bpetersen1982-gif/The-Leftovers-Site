/**
 * Database URL isolation.
 *
 * This project reads ONLY `LEFTOVERS_DATABASE_URL`, never the generic `DATABASE_URL`.
 * The developer's shell exports a `DATABASE_URL` for another project, and dotenv/Next.js
 * never override variables that already exist in the shell, so a generic name would
 * silently point this app (and `prisma migrate`) at the wrong database.
 *
 * As a second guard, outside production the database name must start with "leftovers".
 */

export const DATABASE_URL_VAR = "LEFTOVERS_DATABASE_URL";

const REQUIRED_DB_NAME_PREFIX = "leftovers";

export class DatabaseUrlError extends Error {
  override readonly name = "DatabaseUrlError";
}

/**
 * Returns the validated database URL or throws a DatabaseUrlError with an
 * actionable message. The URL itself is never included in error messages.
 */
export function resolveDatabaseUrl(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const raw = env[DATABASE_URL_VAR]?.trim();
  if (!raw) {
    throw new DatabaseUrlError(
      `${DATABASE_URL_VAR} is not set. Copy .env.example to .env for local development.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new DatabaseUrlError(`${DATABASE_URL_VAR} is not a valid URL.`);
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new DatabaseUrlError(`${DATABASE_URL_VAR} must be a postgresql:// URL.`);
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const isProduction = env.NODE_ENV === "production" && env.LEFTOVERS_ENV === "production";

  if (!isProduction && !databaseName.startsWith(REQUIRED_DB_NAME_PREFIX)) {
    throw new DatabaseUrlError(
      `Refusing to use database "${databaseName}": outside production the database name ` +
        `must start with "${REQUIRED_DB_NAME_PREFIX}". This prevents connecting to another project's database.`,
    );
  }

  return raw;
}
