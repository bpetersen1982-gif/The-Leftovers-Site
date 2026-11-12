import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { exportSubscribersCsv } from "@/lib/mailing/service";
import { can } from "@/lib/permissions";
import { getRequestId } from "@/lib/request-id";
import { todayInBandTimeZone } from "@/lib/dates";

/** CSV download of confirmed subscribers (FAN-8). Admins only; never cached. */
export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response("Log in first.", { status: 401 });
  if (!can(user.role, "mailing:manage")) return new Response("Admins only.", { status: 403 });
  const { csv } = await exportSubscribersCsv(db(), user, { requestId: await getRequestId() });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leftovers-mailing-list-${todayInBandTimeZone()}.csv"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
