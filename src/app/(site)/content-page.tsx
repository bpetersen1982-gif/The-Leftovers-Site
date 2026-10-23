import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BlockContent } from "@/components/block-content";
import { PageBody } from "@/components/site-chrome";
import { PAGES, type PageSlug } from "@/lib/content/pages";
import { getPage } from "@/lib/content/service";
import { db } from "@/lib/db";

export function contentPageMetadata(slug: PageSlug, description: string): Metadata {
  return { title: PAGES[slug].title, description, alternates: { canonical: PAGES[slug].path } };
}

/** Shared renderer for the simple editable pages (About, Privacy, Copyright). */
export async function ContentPage({ slug, children }: { slug: PageSlug; children?: ReactNode }) {
  const page = await getPage(db(), slug);
  return (
    <PageBody title={PAGES[slug].title}>
      <BlockContent blocks={page.blocks} />
      {children}
    </PageBody>
  );
}
