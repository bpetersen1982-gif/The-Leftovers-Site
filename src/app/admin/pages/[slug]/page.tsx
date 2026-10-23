import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { blocksToSource } from "@/lib/content/blocks";
import { PAGES, isPageSlug } from "@/lib/content/pages";
import { getPage } from "@/lib/content/service";
import { db } from "@/lib/db";
import { PageEditor } from "./page-editor";

export const metadata: Metadata = { title: "Edit page" };

export default async function EditPagePage({ params }: { params: Promise<{ slug: string }> }) {
  await requirePermission("content:edit");
  const { slug } = await params;
  if (!isPageSlug(slug)) notFound();
  const page = await getPage(db(), slug);

  return (
    <div className="space-y-6">
      <p>
        <Link href="/admin/pages" className="underline">
          ← All pages
        </Link>
      </p>
      <h1 className="font-heading text-3xl font-bold tracking-wider uppercase">Edit: {PAGES[slug].title}</h1>
      <p className="text-cream/90">{PAGES[slug].description}</p>
      <PageEditor slug={slug} initialSource={blocksToSource(page.blocks)} initialVersion={page.version} publicPath={PAGES[slug].path} />
    </div>
  );
}
