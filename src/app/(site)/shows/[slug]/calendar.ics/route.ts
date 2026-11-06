import { db } from "@/lib/db";
import { getPublicShow, showIcs } from "@/lib/shows/queries";

/** "Add to calendar" file for one public show (EVT-4). */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return new Response("Not found", { status: 404 });
  const show = await getPublicShow(db(), null, slug);
  if (!show) return new Response("Not found", { status: 404 });
  return new Response(showIcs(show), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="leftovers-${show.slug}.ics"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
