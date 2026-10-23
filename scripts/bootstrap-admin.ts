/**
 * Creates an initial Admin account (requirements §2.1). Run once per bootstrap Admin:
 *
 *   pnpm admin:bootstrap --email person@example.com --name "Person Name"
 *
 * Idempotent: running it again for an existing Admin does nothing. It never changes an
 * existing user's role. Emails are passed as arguments so they're never committed.
 * The person then logs in at /login with a magic link.
 */
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadDotenv } from "dotenv";
import { PrismaClient } from "../src/generated/prisma/client";
import { resolveDatabaseUrl } from "../src/lib/database-url";
import { bootstrapAdmin } from "../src/lib/users/service";
import { emailSchema, personNameSchema } from "../src/lib/users/validation";

loadDotenv({ quiet: true });

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { email: { type: "string" }, name: { type: "string" } },
    strict: true,
  });
  const email = emailSchema.safeParse(values.email ?? "");
  const name = personNameSchema.safeParse(values.name ?? "");
  if (!email.success || !name.success) {
    console.error('Usage: pnpm admin:bootstrap --email person@example.com --name "Person Name"');
    if (!email.success) console.error(`  email: ${email.error.issues[0]?.message}`);
    if (!name.success) console.error(`  name: ${name.error.issues[0]?.message}`);
    process.exitCode = 2;
    return;
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: resolveDatabaseUrl(process.env) }) });
  try {
    const result = await bootstrapAdmin(prisma, { email: email.data, name: name.data });
    console.log(result.status === "created" ? `Created Admin: ${name.data}` : `Already an Admin: ${name.data} (no change)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
