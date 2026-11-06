import { z } from "zod";

/**
 * Points Cloudflare Stream's webhook at this site and prints the signing secret to stdout
 * (and nothing else), so it can be piped straight into Railway without being shown:
 *
 *   railway run --service web -- pnpm exec tsx scripts/stream-webhook.ts \
 *     | railway variable set CF_STREAM_WEBHOOK_SECRET --stdin --service web
 *
 * Stream allows one webhook per account; running this again replaces it (new secret).
 */
const env = z
  .object({
    CF_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/),
    CF_STREAM_API_TOKEN: z.string().min(20),
    APP_URL: z.url().refine((url) => url.startsWith("https://"), "Stream needs a public https URL"),
  })
  .parse(process.env);

const notificationUrl = `${env.APP_URL.replace(/\/+$/, "")}/api/stream/webhook`;
const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/stream/webhook`, {
  method: "PUT",
  headers: { Authorization: `Bearer ${env.CF_STREAM_API_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ notificationUrl }),
});
const body = z
  .object({ success: z.boolean(), result: z.object({ secret: z.string().min(16), notificationUrl: z.string() }).nullable().optional(), errors: z.array(z.unknown()).optional() })
  .parse(await response.json());
if (!response.ok || !body.success || !body.result) {
  console.error(`Webhook registration failed (${response.status}): ${JSON.stringify(body.errors ?? [])}`);
  process.exit(1);
}
console.error(`Stream webhook now points at ${body.result.notificationUrl}`);
process.stdout.write(body.result.secret);
